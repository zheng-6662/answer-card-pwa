(() => {
  "use strict";

  const CANONICAL_WIDTH = 1600;
  const CANONICAL_HEIGHT = 760;
  const QUESTION_COUNT = 55;
  const LETTERS = Array.from("ABCDEFG");
  const MIN_MARK_SCORE = 0.22;
  const MIN_CONFIDENCE = 0.06;
  const TARGET_ASPECT = CANONICAL_WIDTH / CANONICAL_HEIGHT;
  const SCAN_INTERVAL_MS = 1800;
  const PRESET_ANSWER_GROUPS = [
    "1-5 CBAAC",
    "6-10 CCAAC",
    "11-15 CCBBC",
    "16-20 BBBAA",
    "21-25 ADBCA",
    "26-30 BCBDD",
    "31-35 ADCAD",
    "36-40 BECAD",
    "41-45 CDABB",
    "46-50 CDAAD",
    "51-55 BDACB"
  ];
  const PRESET_ANSWER_KEY = "CBAACCCAACCCBBCBBBAAADBCABCBDDADCADBECADCDABBCDAADBDACB";
  const PRESET_SCORE_RULES = "1-20:1.5 21-40:2.5 41-55:1";
  const COMPLETE_SCAN_MIN_RECOGNIZED = 46;
  const MIN_GRID_QUESTION_COVERAGE = 0.62;
  const MIN_GRID_BOX_COVERAGE = 0.36;
  const MIN_GRID_AVERAGE_SCORE = 0.08;

  const BLOCKS = [
    { startQuestion: 1, questionCount: 5, choiceCount: 3, x0: 178.0, dx: 55.0, y0: 82.0, dy: 35.3 },
    { startQuestion: 6, questionCount: 5, choiceCount: 3, x0: 517.0, dx: 53.0, y0: 88.0, dy: 35.0 },
    { startQuestion: 11, questionCount: 5, choiceCount: 3, x0: 850.0, dx: 50.0, y0: 101.0, dy: 34.0 },
    { startQuestion: 16, questionCount: 5, choiceCount: 3, x0: 1163.0, dx: 48.0, y0: 114.0, dy: 33.5 },
    { startQuestion: 21, questionCount: 5, choiceCount: 4, x0: 163.0, dx: 55.5, y0: 310.0, dy: 36.0 },
    { startQuestion: 26, questionCount: 5, choiceCount: 4, x0: 518.0, dx: 53.0, y0: 318.0, dy: 35.5 },
    { startQuestion: 31, questionCount: 5, choiceCount: 4, x0: 856.0, dx: 50.5, y0: 327.0, dy: 35.0 },
    { startQuestion: 36, questionCount: 5, choiceCount: 7, x0: 1175.0, dx: 48.5, y0: 337.0, dy: 34.0 },
    { startQuestion: 41, questionCount: 5, choiceCount: 4, x0: 154.0, dx: 56.5, y0: 548.0, dy: 37.5 },
    { startQuestion: 46, questionCount: 5, choiceCount: 4, x0: 516.0, dx: 54.0, y0: 551.0, dy: 36.8 },
    { startQuestion: 51, questionCount: 5, choiceCount: 4, x0: 861.0, dx: 51.0, y0: 555.0, dy: 35.6 }
  ];

  const state = {
    stream: null,
    scanTimer: null,
    scanning: false,
    processing: false,
    lastOutput: null,
    history: [],
    deferredPrompt: null
  };

  const el = {};

  window.addEventListener("DOMContentLoaded", init);
  window.addEventListener("resize", () => drawCameraFrame());
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    if (el.installButton) {
      el.installButton.hidden = false;
    }
  });

  function init() {
    Object.assign(el, {
      video: document.getElementById("video"),
      cameraStage: document.getElementById("cameraStage"),
      cameraOverlay: document.getElementById("cameraOverlay"),
      cameraEmpty: document.getElementById("cameraEmpty"),
      startButton: document.getElementById("startButton"),
      stopButton: document.getElementById("stopButton"),
      fileInput: document.getElementById("fileInput"),
      statusText: document.getElementById("statusText"),
      scoreMetric: document.getElementById("scoreMetric"),
      recognizedMetric: document.getElementById("recognizedMetric"),
      correctMetric: document.getElementById("correctMetric"),
      presetAnswerText: document.getElementById("presetAnswerText"),
      presetScoreText: document.getElementById("presetScoreText"),
      successPanel: document.getElementById("successPanel"),
      successScore: document.getElementById("successScore"),
      successDetail: document.getElementById("successDetail"),
      nextScanButton: document.getElementById("nextScanButton"),
      resultCanvas: document.getElementById("resultCanvas"),
      questionRows: document.getElementById("questionRows"),
      historyRows: document.getElementById("historyRows"),
      saveResultButton: document.getElementById("saveResultButton"),
      clearHistoryButton: document.getElementById("clearHistoryButton"),
      installButton: document.getElementById("installButton")
    });

    loadSettings();
    bindEvents();
    drawCameraFrame();
    drawEmptyResult();
    updateMetrics(null);
    renderQuestions([]);
    renderHistory();
    registerServiceWorker();
  }

  function bindEvents() {
    el.startButton.addEventListener("click", startScan);
    el.stopButton.addEventListener("click", stopScan);
    el.fileInput.addEventListener("change", handleFile);
    el.saveResultButton.addEventListener("click", saveCurrentResult);
    el.clearHistoryButton.addEventListener("click", clearHistory);
    el.nextScanButton.addEventListener("click", startNextScan);
    el.installButton.addEventListener("click", async () => {
      if (!state.deferredPrompt) {
        return;
      }
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
      el.installButton.hidden = true;
    });
  }

  function loadSettings() {
    el.presetAnswerText.textContent = PRESET_ANSWER_GROUPS.join("  ");
    el.presetScoreText.textContent = "1-20 每题 1.5 分；21-40 每题 2.5 分；41-55 每题 1 分";
    try {
      state.history = JSON.parse(localStorage.getItem("answer-card.history") || "[]");
    } catch {
      state.history = [];
    }
  }

  async function startScan() {
    if (state.scanning) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("当前浏览器不支持相机。", "bad");
      return;
    }
    if (!window.isSecureContext) {
      setStatus("相机需要 HTTPS 地址；发布到 HTTPS 后可在 iPhone Safari 使用。", "bad");
      return;
    }

    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      el.video.srcObject = state.stream;
      await el.video.play();
      state.scanning = true;
      hideSuccessPanel();
      el.cameraEmpty.classList.add("hidden");
      setStatus("扫描中：把答题卡完整放进画面，停稳后会自动刷新。");
      drawCameraFrame();
      scheduleScan(250);
    } catch (error) {
      setStatus(`无法打开相机：${cleanMessage(error)}`, "bad");
      stopScan();
    }
  }

  function stopScan(options = {}) {
    state.scanning = false;
    clearTimeout(state.scanTimer);
    state.scanTimer = null;
    if (state.stream) {
      for (const track of state.stream.getTracks()) {
        track.stop();
      }
    }
    state.stream = null;
    el.video.srcObject = null;
    el.cameraEmpty.classList.remove("hidden");
    if (!options.silent) {
      setStatus("扫描已停止。");
    }
    drawCameraFrame();
  }

  function scheduleScan(delay = SCAN_INTERVAL_MS) {
    clearTimeout(state.scanTimer);
    if (!state.scanning) {
      return;
    }
    state.scanTimer = setTimeout(scanFrame, delay);
  }

  async function scanFrame() {
    if (!state.scanning) {
      return;
    }
    if (state.processing || el.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      scheduleScan(500);
      return;
    }
    const canvas = captureVideoCanvas();
    await processCanvas(canvas, "相机");
    scheduleScan();
  }

  function captureVideoCanvas() {
    const width = el.video.videoWidth || 1280;
    const height = el.video.videoHeight || 720;
    const canvas = makeCanvas(width, height);
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(el.video, 0, 0, width, height);
    return canvas;
  }

  async function handleFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    try {
      const image = await loadImage(file);
      const canvas = imageToCanvas(image);
      await processCanvas(canvas, "照片");
    } catch (error) {
      setStatus(`照片读取失败：${cleanMessage(error)}`, "bad");
    } finally {
      event.target.value = "";
    }
  }

  async function processCanvas(canvas, sourceName) {
    if (state.processing) {
      return;
    }
    state.processing = true;
    drawCameraFrame(true);
    setStatus(`正在识别${sourceName}...`);
    await nextFrame();

    const startedAt = performance.now();
    try {
      const output = grade(canvas, PRESET_ANSWER_KEY, PRESET_SCORE_RULES);
      state.lastOutput = output;
      drawResult(output);
      updateMetrics(output);
      renderQuestions(output.questions);
      el.saveResultButton.disabled = false;
      const elapsed = Math.round(performance.now() - startedAt);
      setStatus(`扫描成功：${output.sheetValidation.summary}，耗时 ${elapsed}ms`, "good");
      completeScan(output);
    } catch (error) {
      const message = cleanMessage(error);
      setStatus(message.includes("完整答题卡") ? message : `识别失败：${message}`, message.includes("完整答题卡") ? "warn" : "bad");
    } finally {
      state.processing = false;
      drawCameraFrame(false);
    }
  }

  function completeScan(output) {
    stopScan({ silent: true });
    showSuccessPanel(output);
    addHistoryItem(output);
    renderHistory();
    setTimeout(() => {
      el.successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }

  function showSuccessPanel(output) {
    el.successPanel.hidden = false;
    if (output.gradedCount > 0) {
      el.successScore.textContent = `${formatNumber(output.earnedPoints)} / ${formatNumber(output.totalPossiblePoints)}`;
      el.successDetail.textContent = `正确 ${output.correctCount}/${output.gradedCount}，识别 ${output.recognizedCount}/55，${output.scorePercent.toFixed(1)}%。`;
    } else {
      el.successScore.textContent = `${output.recognizedCount}/55`;
      el.successDetail.textContent = "未配置标答，仅显示识别题数。";
    }
  }

  function hideSuccessPanel() {
    el.successPanel.hidden = true;
  }

  function resetCurrentResult() {
    state.lastOutput = null;
    updateMetrics(null);
    renderQuestions([]);
    drawEmptyResult();
    el.saveResultButton.disabled = true;
  }

  async function startNextScan() {
    hideSuccessPanel();
    resetCurrentResult();
    setStatus("准备扫描下一份。");
    await startScan();
  }

  function grade(sourceCanvas, answerKeyText, scoreRuleText) {
    const answerKey = parseAnswerKey(answerKeyText);
    const pointValues = parseScoreRules(scoreRuleText, QUESTION_COUNT);
    const candidates = buildCandidates(sourceCanvas);
    if (!candidates.length) {
      throw new Error("没有找到有效图像");
    }

    const shortlist = [];
    for (const candidate of candidates) {
      const gray = new GrayImage(candidate.canvas);
      const global = findGlobalAlignment(gray);
      insertShortlist({ candidate, gray, global, quickQuality: global.quality }, shortlist, 2);
    }

    let bestOutput = null;
    let bestQuality = -Infinity;
    let bestRejected = null;
    for (const scored of shortlist) {
      const output = gradeCanonical(scored.candidate, scored.gray, scored.global, answerKey, pointValues);
        output.sheetValidation = evaluateSheet(scored.gray, output);
      const quality = output.sheetValidation.score * 1400.0
        + output.sheetValidation.grid.questionCoverage * 1600.0
        + output.sheetValidation.grid.boxCoverage * 700.0
        + output.recognizedCount * 100.0
        + output.layoutConfidence * 20.0
        + scored.quickQuality * 0.05;
      if (!output.sheetValidation.valid) {
        if (!bestRejected || quality > bestRejected.quality) {
          bestRejected = { output, quality };
        }
        continue;
      }
      if (!bestOutput || quality > bestQuality) {
        bestOutput = output;
        bestQuality = quality;
      }
    }

    if (!bestOutput) {
      const detail = bestRejected ? `（${bestRejected.output.sheetValidation.summary}）` : "";
      throw new Error(`未检测到完整答题卡，请把整张答题卡放进画面${detail}`);
    }
    return bestOutput;
  }

  function parseAnswerKey(text) {
    const result = {};
    const regex = /(\d{1,2})\s*(?:题)?\s*[:：=\-、,，.]?\s*([A-Ga-g])/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const number = Number.parseInt(match[1], 10);
      if (number >= 1 && number <= 99) {
        result[number] = match[2].toUpperCase();
      }
    }

    if (Object.keys(result).length === 0) {
      const compact = Array.from(text.toUpperCase()).filter((char) => LETTERS.includes(char));
      compact.slice(0, 99).forEach((answer, index) => {
        result[index + 1] = answer;
      });
    }
    return result;
  }

  function parseScoreRules(text, questionCount) {
    const points = Array(questionCount + 1).fill(1.0);
    const raw = text.trim();
    if (!raw) {
      return points;
    }

    const single = raw.match(/^\s*(?:每题|默认|default|all)?\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:分)?\s*$/i);
    if (single) {
      const value = Math.max(0, Number.parseFloat(single[1]));
      for (let question = 1; question <= questionCount; question += 1) {
        points[question] = value;
      }
      return points;
    }

    const defaultMatch = raw.match(/(?:每题|默认|default|all)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:分)?/i);
    if (defaultMatch) {
      const value = Math.max(0, Number.parseFloat(defaultMatch[1]));
      for (let question = 1; question <= questionCount; question += 1) {
        points[question] = value;
      }
    }

    const rangeRegex = /(\d{1,2})\s*(?:[-~—至到]\s*(\d{1,2}))?\s*(?:题)?\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:分)?/g;
    let match;
    while ((match = rangeRegex.exec(raw)) !== null) {
      const start = Number.parseInt(match[1], 10);
      const end = match[2] ? Number.parseInt(match[2], 10) : start;
      const value = Math.max(0, Number.parseFloat(match[3]));
      const lower = Math.max(1, Math.min(questionCount, Math.min(start, end)));
      const upper = Math.max(1, Math.min(questionCount, Math.max(start, end)));
      for (let question = lower; question <= upper; question += 1) {
        points[question] = value;
      }
    }
    return points;
  }

  function buildCandidates(sourceCanvas) {
    const fitted = fitCanvas(sourceCanvas, 1800);
    const candidates = [];
    for (const degrees of preferredRotations(fitted)) {
      const rotated = rotateCanvas(fitted, degrees);
      addCanonicalCandidate(rotated, `rot=${degrees} full`, candidates);

      const cropped = autoCrop(rotated);
      if (cropped) {
        addCanonicalCandidate(
          cropped.canvas,
          `rot=${degrees} crop=${cropped.x},${cropped.y} ${cropped.width}x${cropped.height}`,
          candidates
        );
      }
      addAspectCandidates(rotated, degrees, candidates);
    }
    return candidates;
  }

  function preferredRotations(canvas) {
    const width = canvas.width;
    const height = canvas.height;
    if (height > width * 1.12) {
      return [90, 270];
    }
    if (width > height * 1.12) {
      return [0, 180];
    }
    return [0, 90, 180, 270];
  }

  function addAspectCandidates(canvas, degrees, candidates) {
    const width = canvas.width;
    const height = canvas.height;
    const aspect = width / height;
    const fractions = [0, 0.5, 1];

    if (aspect > TARGET_ASPECT) {
      const cropWidth = Math.max(1, Math.min(width, Math.round(height * TARGET_ASPECT)));
      const maxX = width - cropWidth;
      for (const fraction of fractions) {
        const x = Math.round(maxX * fraction);
        addCanonicalCandidate(cropCanvas(canvas, x, 0, cropWidth, height), `rot=${degrees} aspect-x=${fraction.toFixed(2)}`, candidates);
      }
    } else {
      const cropHeight = Math.max(1, Math.min(height, Math.round(width / TARGET_ASPECT)));
      const maxY = height - cropHeight;
      for (const fraction of fractions) {
        const y = Math.round(maxY * fraction);
        addCanonicalCandidate(cropCanvas(canvas, 0, y, width, cropHeight), `rot=${degrees} aspect-y=${fraction.toFixed(2)}`, candidates);
      }
    }
  }

  function addCanonicalCandidate(canvas, note, candidates) {
    if (!canvas || canvas.width < 80 || canvas.height < 80) {
      return;
    }
    candidates.push({
      canvas: resizeCanvas(canvas, CANONICAL_WIDTH, CANONICAL_HEIGHT),
      note
    });
  }

  function autoCrop(canvas) {
    const gray = new GrayImage(canvas);
    const threshold = Math.min(160, gray.otsuThreshold() + 10);
    let minX = gray.width;
    let minY = gray.height;
    let maxX = -1;
    let maxY = -1;
    let darkCount = 0;
    const step = Math.max(1, Math.floor(Math.max(gray.width, gray.height) / 1400));

    for (let y = 0; y < gray.height; y += step) {
      const row = y * gray.width;
      for (let x = 0; x < gray.width; x += step) {
        if (gray.gray[row + x] < threshold) {
          darkCount += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (darkCount < 200 || maxX <= minX || maxY <= minY) {
      return null;
    }

    const padX = Math.max(4, Math.floor((maxX - minX) / 80));
    const padY = Math.max(4, Math.floor((maxY - minY) / 80));
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(gray.width - 1, maxX + padX);
    maxY = Math.min(gray.height - 1, maxY + padY);
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    return {
      canvas: cropCanvas(canvas, minX, minY, width, height),
      x: minX,
      y: minY,
      width,
      height
    };
  }

  function gradeCanonical(candidate, gray, global, answerKey, pointValues) {
    const output = {
      canonicalCanvas: candidate.canvas,
      questions: [],
      recognizedCount: 0,
      answerKeyCount: Object.keys(answerKey).length,
      gradedCount: 0,
      correctCount: 0,
      earnedPoints: 0,
      totalPossiblePoints: 0,
      scorePercent: 0,
      layoutConfidence: 0,
      cropNote: candidate.note
    };
    let totalConfidence = 0;
    let alignNote = ` global=(${global.offsetX},${global.offsetY})`;

    for (const block of BLOCKS) {
      const alignment = findBlockAlignment(gray, block, global);
      totalConfidence += alignment.confidenceSum;
      alignNote += ` ${block.startQuestion}:${alignment.offsetX},${alignment.offsetY}`;

      for (let row = 0; row < block.questionCount; row += 1) {
        const questionNumber = block.startQuestion + row;
        const scores = [];
        const centers = [];
        for (let choice = 0; choice < block.choiceCount; choice += 1) {
          const cx = Math.round(block.x0 + alignment.offsetX + block.dx * choice);
          const cy = Math.round(block.y0 + alignment.offsetY + block.dy * row);
          centers.push([cx, cy]);
          scores.push(fillScore(gray, cx, cy));
        }

        const best = bestIndex(scores);
        const bestScore = scores[best];
        const second = secondBest(scores, best);
        const confidence = bestScore - second;
        const selected = bestScore >= MIN_MARK_SCORE && confidence >= MIN_CONFIDENCE ? LETTERS[best] : null;
        const answer = answerKey[questionNumber] || null;
        const correct = Boolean(answer && selected && answer === selected);
        const pointValue = pointValues[questionNumber] ?? 1.0;

        output.questions.push({
          number: questionNumber,
          choiceCount: block.choiceCount,
          selected,
          answer,
          hasAnswer: Boolean(answer),
          correct,
          pointValue,
          earnedValue: correct ? pointValue : 0,
          bestScore,
          secondScore: second,
          confidence,
          bestCenterX: centers[best][0],
          bestCenterY: centers[best][1],
          choiceCenters: centers,
          scores
        });

        if (selected) {
          output.recognizedCount += 1;
        }
        if (answer) {
          output.gradedCount += 1;
          output.totalPossiblePoints += pointValue;
          if (correct) {
            output.correctCount += 1;
            output.earnedPoints += pointValue;
          }
        }
      }
    }

    output.layoutConfidence = totalConfidence / QUESTION_COUNT;
    output.cropNote += alignNote;
    if (output.totalPossiblePoints > 0) {
      output.scorePercent = (100 * output.earnedPoints) / output.totalPossiblePoints;
    }
    return output;
  }

  function evaluateSheet(gray, output) {
    const content = { x1: 40, y1: 35, x2: gray.width - 41, y2: gray.height - 36 };
    const pageMean = gray.mean(content);
    const veryDarkFraction = gray.fractionBelow(content, 70);
    const darkFraction = gray.fractionBelow(content, 110);
    const frame = estimateFrame(gray);
    const grid = estimateOptionGrid(gray, output);
    const averageConfidence = output.questions.reduce((sum, question) => sum + Math.max(0, question.confidence), 0) / QUESTION_COUNT;
    const recognizedRatio = output.recognizedCount / QUESTION_COUNT;

    const problems = [];
    if (output.recognizedCount < COMPLETE_SCAN_MIN_RECOGNIZED) {
      problems.push(`识别题数不足 ${output.recognizedCount}/55`);
    }
    if (pageMean < 138) {
      problems.push("画面整体过暗");
    }
    if (veryDarkFraction > 0.24 || darkFraction > 0.42) {
      problems.push("画面里非答题卡区域过多");
    }
    if (frame.count < 2 && frame.score < 0.55) {
      problems.push("没有检测到完整答题卡边框");
    }
    if (grid.questionCoverage < MIN_GRID_QUESTION_COVERAGE || grid.boxCoverage < MIN_GRID_BOX_COVERAGE || grid.averageScore < MIN_GRID_AVERAGE_SCORE) {
      problems.push("选择框网格没有对齐");
    }

    const score = clamp((pageMean - 120) / 80, 0, 1.4)
      + clamp((0.42 - darkFraction) * 3.0, -1.0, 1.2)
      + frame.score
      + grid.questionCoverage * 1.8
      + grid.boxCoverage
      + recognizedRatio
      + clamp(averageConfidence * 2.0, 0, 1.2);

    const summary = `亮度 ${pageMean.toFixed(0)}，暗区 ${(darkFraction * 100).toFixed(0)}%，边框 ${frame.count}/4，网格 ${(grid.questionCoverage * 100).toFixed(0)}%，识别 ${output.recognizedCount}/55`;
    return {
      valid: problems.length === 0,
      problems,
      score,
      pageMean,
      veryDarkFraction,
      darkFraction,
      frame,
      grid,
      averageConfidence,
      summary
    };
  }

  function estimateOptionGrid(gray, output) {
    let totalBoxes = 0;
    let strongBoxes = 0;
    let scoreSum = 0;
    let coveredQuestions = 0;
    let strongQuestionCount = 0;

    for (const question of output.questions) {
      const centers = question.choiceCenters || [];
      let questionStrong = 0;
      let questionSum = 0;
      for (const center of centers) {
        const score = optionBoxStructureScore(gray, center[0], center[1]);
        totalBoxes += 1;
        scoreSum += score;
        questionSum += score;
        if (score >= 0.13) {
          strongBoxes += 1;
          questionStrong += 1;
        }
      }
      if (questionStrong >= Math.min(2, centers.length)) {
        coveredQuestions += 1;
      }
      if (centers.length && questionSum / centers.length >= 0.16) {
        strongQuestionCount += 1;
      }
    }

    return {
      boxCoverage: totalBoxes ? strongBoxes / totalBoxes : 0,
      questionCoverage: output.questions.length ? coveredQuestions / output.questions.length : 0,
      strongQuestionCoverage: output.questions.length ? strongQuestionCount / output.questions.length : 0,
      averageScore: totalBoxes ? scoreSum / totalBoxes : 0,
      totalBoxes,
      strongBoxes,
      coveredQuestions
    };
  }

  function optionBoxStructureScore(gray, cx, cy) {
    const outer = rectI(cx, cy, 28, 18, gray.width, gray.height);
    if (rectArea(outer) <= 0) {
      return 0;
    }
    const local = gray.mean(outer);
    const threshold = clamp(local - 30, 70, 150);
    const top = gray.fractionBelow(rectI(cx, cy - 10, 18, 1, gray.width, gray.height), threshold);
    const bottom = gray.fractionBelow(rectI(cx, cy + 10, 18, 1, gray.width, gray.height), threshold);
    const left = gray.fractionBelow(rectI(cx - 18, cy, 1, 10, gray.width, gray.height), threshold);
    const right = gray.fractionBelow(rectI(cx + 18, cy, 1, 10, gray.width, gray.height), threshold);
    const horizontalPair = Math.min(top, bottom);
    const verticalPair = Math.min(left, right);
    const edgeAverage = (top + bottom + left + right) / 4;
    const pairScore = (horizontalPair + verticalPair) / 2;
    return 0.62 * pairScore + 0.38 * edgeAverage;
  }

  function estimateFrame(gray) {
    const top = strongestHorizontalLine(gray, 5, 120, 40, gray.width - 41);
    const bottom = strongestHorizontalLine(gray, gray.height - 130, gray.height - 6, 40, gray.width - 41);
    const left = strongestVerticalLine(gray, 5, 150, 40, gray.height - 41);
    const right = strongestVerticalLine(gray, gray.width - 160, gray.width - 6, 40, gray.height - 41);
    const values = [top, bottom, left, right];
    const count = values.filter((value) => value >= 0.16).length;
    const score = values.reduce((sum, value) => sum + clamp(value / 0.28, 0, 1), 0) / 4;
    return { top, bottom, left, right, count, score };
  }

  function strongestHorizontalLine(gray, yStart, yEnd, x1, x2) {
    let best = 0;
    const start = clamp(Math.round(yStart), 0, gray.height - 1);
    const end = clamp(Math.round(yEnd), 0, gray.height - 1);
    const left = clamp(Math.round(x1), 0, gray.width - 1);
    const right = clamp(Math.round(x2), 0, gray.width - 1);
    for (let y = start; y <= end; y += 1) {
      const rect = { x1: left, y1: y, x2: right, y2: Math.min(gray.height - 1, y + 2) };
      best = Math.max(best, gray.fractionBelow(rect, 95));
    }
    return best;
  }

  function strongestVerticalLine(gray, xStart, xEnd, y1, y2) {
    let best = 0;
    const start = clamp(Math.round(xStart), 0, gray.width - 1);
    const end = clamp(Math.round(xEnd), 0, gray.width - 1);
    const top = clamp(Math.round(y1), 0, gray.height - 1);
    const bottom = clamp(Math.round(y2), 0, gray.height - 1);
    for (let x = start; x <= end; x += 1) {
      const rect = { x1: x, y1: top, x2: Math.min(gray.width - 1, x + 2), y2: bottom };
      best = Math.max(best, gray.fractionBelow(rect, 95));
    }
    return best;
  }

  function findGlobalAlignment(gray) {
    let best = null;
    for (let ox = -120; ox <= 120; ox += 20) {
      for (let oy = -90; oy <= 90; oy += 20) {
        let boxSum = 0;
        let confidenceSum = 0;
        for (const block of BLOCKS) {
          for (let row = 0; row < block.questionCount; row += 1) {
            const scores = [];
            for (let choice = 0; choice < block.choiceCount; choice += 1) {
              const cx = Math.round(block.x0 + ox + block.dx * choice);
              const cy = Math.round(block.y0 + oy + block.dy * row);
              scores.push(fillScore(gray, cx, cy));
              boxSum += boxScore(gray, cx, cy);
            }
            const bestChoice = bestIndex(scores);
            confidenceSum += Math.max(0, scores[bestChoice] - secondBest(scores, bestChoice));
          }
        }
        const quality = boxSum + confidenceSum * 1.5 - 0.02 * (Math.abs(ox) + Math.abs(oy));
        if (!best || quality > best.quality) {
          best = { offsetX: ox, offsetY: oy, recognizedCount: 0, confidenceSum, quality };
        }
      }
    }
    return best || { offsetX: 0, offsetY: 0, recognizedCount: 0, confidenceSum: 0, quality: 0 };
  }

  function findBlockAlignment(gray, block, global) {
    let best = null;
    for (let ox = global.offsetX - 35; ox <= global.offsetX + 35; ox += 5) {
      for (let oy = global.offsetY - 35; oy <= global.offsetY + 35; oy += 5) {
        let recognized = 0;
        let boxSum = 0;
        let confidenceSum = 0;
        for (let row = 0; row < block.questionCount; row += 1) {
          const scores = [];
          for (let choice = 0; choice < block.choiceCount; choice += 1) {
            const cx = Math.round(block.x0 + ox + block.dx * choice);
            const cy = Math.round(block.y0 + oy + block.dy * row);
            scores.push(fillScore(gray, cx, cy));
            boxSum += boxScore(gray, cx, cy);
          }
          const bestChoice = bestIndex(scores);
          const bestScore = scores[bestChoice];
          const confidence = bestScore - secondBest(scores, bestChoice);
          confidenceSum += Math.max(0, confidence);
          if (bestScore >= MIN_MARK_SCORE && confidence >= MIN_CONFIDENCE) {
            recognized += 1;
          }
        }
        const quality = boxSum
          + confidenceSum * 1.5
          + recognized * 0.4
          - 0.04 * (Math.abs(ox - global.offsetX) + Math.abs(oy - global.offsetY));
        if (!best || quality > best.quality) {
          best = { offsetX: ox, offsetY: oy, recognizedCount: recognized, confidenceSum, quality };
        }
      }
    }
    return best || global;
  }

  function fillScore(gray, cx, cy) {
    const outer = rectI(cx, cy, 30, 20, gray.width, gray.height);
    const inner = rectI(cx, cy, 11, 6, gray.width, gray.height);
    if (rectArea(inner) <= 0 || rectArea(outer) <= 0) {
      return 0;
    }
    const local = gray.mean(outer) + 25;
    const mean = gray.mean(inner);
    const fraction = gray.fractionBelow(inner, local - 40);
    const contrast = clamp((local - mean) / 85, 0, 1);
    return 0.65 * fraction + 0.35 * contrast;
  }

  function boxScore(gray, cx, cy) {
    const outer = rectI(cx, cy, 34, 22, gray.width, gray.height);
    const region = rectI(cx, cy, 20, 12, gray.width, gray.height);
    if (rectArea(region) <= 0 || rectArea(outer) <= 0) {
      return 0;
    }
    const local = gray.mean(outer) + 20;
    const mean = gray.mean(region);
    const fraction = gray.fractionBelow(region, local - 35);
    const contrast = clamp((local - mean) / 70, 0, 1);
    return 0.55 * fraction + 0.45 * contrast;
  }

  function bestIndex(scores) {
    let best = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (scores[index] > scores[best]) {
        best = index;
      }
    }
    return best;
  }

  function secondBest(scores, best) {
    let second = 0;
    for (let index = 0; index < scores.length; index += 1) {
      if (index !== best) {
        second = Math.max(second, scores[index]);
      }
    }
    return second;
  }

  function insertShortlist(scored, shortlist, limit) {
    let index = 0;
    while (index < shortlist.length && shortlist[index].quickQuality >= scored.quickQuality) {
      index += 1;
    }
    shortlist.splice(index, 0, scored);
    while (shortlist.length > limit) {
      shortlist.pop();
    }
  }

  class GrayImage {
    constructor(canvas) {
      this.width = canvas.width;
      this.height = canvas.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const rgba = context.getImageData(0, 0, this.width, this.height).data;
      this.gray = new Uint8Array(this.width * this.height);
      this.integral = new Int32Array((this.width + 1) * (this.height + 1));

      const stride = this.width + 1;
      for (let y = 0; y < this.height; y += 1) {
        let rowSum = 0;
        for (let x = 0; x < this.width; x += 1) {
          const rgbaOffset = (y * this.width + x) * 4;
          const value = Math.round((rgba[rgbaOffset] * 299 + rgba[rgbaOffset + 1] * 587 + rgba[rgbaOffset + 2] * 114) / 1000);
          this.gray[y * this.width + x] = value;
          rowSum += value;
          this.integral[(y + 1) * stride + x + 1] = this.integral[y * stride + x + 1] + rowSum;
        }
      }
    }

    mean(rect) {
      const area = rectArea(rect);
      if (area <= 0) {
        return 255;
      }
      const stride = this.width + 1;
      const sum = this.integral[(rect.y2 + 1) * stride + rect.x2 + 1]
        - this.integral[rect.y1 * stride + rect.x2 + 1]
        - this.integral[(rect.y2 + 1) * stride + rect.x1]
        + this.integral[rect.y1 * stride + rect.x1];
      return sum / area;
    }

    fractionBelow(rect, threshold) {
      const area = rectArea(rect);
      if (area <= 0) {
        return 0;
      }
      let count = 0;
      for (let y = rect.y1; y <= rect.y2; y += 1) {
        const row = y * this.width;
        for (let x = rect.x1; x <= rect.x2; x += 1) {
          if (this.gray[row + x] < threshold) {
            count += 1;
          }
        }
      }
      return count / area;
    }

    otsuThreshold() {
      const hist = new Int32Array(256);
      for (const value of this.gray) {
        hist[value] += 1;
      }

      const total = this.gray.length;
      let sum = 0;
      for (let threshold = 0; threshold < 256; threshold += 1) {
        sum += threshold * hist[threshold];
      }

      let sumB = 0;
      let wB = 0;
      let maxVariance = -Infinity;
      let bestThreshold = 128;
      for (let threshold = 0; threshold < 256; threshold += 1) {
        wB += hist[threshold];
        if (wB === 0) {
          continue;
        }
        const wF = total - wB;
        if (wF === 0) {
          break;
        }
        sumB += threshold * hist[threshold];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);
        if (variance > maxVariance) {
          maxVariance = variance;
          bestThreshold = threshold;
        }
      }
      return bestThreshold;
    }
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function imageToCanvas(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = makeCanvas(width, height);
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, width, height);
    return canvas;
  }

  function fitCanvas(canvas, maxDimension) {
    const maxSide = Math.max(canvas.width, canvas.height);
    if (maxSide <= maxDimension) {
      return cloneCanvas(canvas);
    }
    const scale = maxDimension / maxSide;
    return resizeCanvas(canvas, Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
  }

  function cloneCanvas(canvas) {
    const result = makeCanvas(canvas.width, canvas.height);
    result.getContext("2d", { willReadFrequently: true }).drawImage(canvas, 0, 0);
    return result;
  }

  function resizeCanvas(canvas, width, height) {
    const result = makeCanvas(width, height);
    result.getContext("2d", { willReadFrequently: true }).drawImage(canvas, 0, 0, result.width, result.height);
    return result;
  }

  function rotateCanvas(canvas, degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    if (normalized === 0) {
      return cloneCanvas(canvas);
    }
    const swap = normalized === 90 || normalized === 270;
    const result = makeCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
    const context = result.getContext("2d", { willReadFrequently: true });
    context.translate(result.width / 2, result.height / 2);
    context.rotate((normalized * Math.PI) / 180);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return result;
  }

  function cropCanvas(canvas, x, y, width, height) {
    const sx = clamp(Math.round(x), 0, canvas.width - 1);
    const sy = clamp(Math.round(y), 0, canvas.height - 1);
    const sw = clamp(Math.round(width), 1, canvas.width - sx);
    const sh = clamp(Math.round(height), 1, canvas.height - sy);
    const result = makeCanvas(sw, sh);
    result.getContext("2d", { willReadFrequently: true }).drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return result;
  }

  function rectI(cx, cy, halfW, halfH, width, height) {
    return {
      x1: clamp(cx - halfW, 0, width - 1),
      x2: clamp(cx + halfW, 0, width - 1),
      y1: clamp(cy - halfH, 0, height - 1),
      y2: clamp(cy + halfH, 0, height - 1)
    };
  }

  function rectArea(rect) {
    if (rect.x2 < rect.x1 || rect.y2 < rect.y1) {
      return 0;
    }
    return (rect.x2 - rect.x1 + 1) * (rect.y2 - rect.y1 + 1);
  }

  function drawCameraFrame(isBusy = state.processing) {
    if (!el.cameraOverlay || !el.cameraStage) {
      return;
    }
    const rect = el.cameraStage.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    el.cameraOverlay.width = Math.max(1, Math.round(rect.width * ratio));
    el.cameraOverlay.height = Math.max(1, Math.round(rect.height * ratio));
    const context = el.cameraOverlay.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    const margin = Math.max(18, rect.width * 0.07);
    const x = margin;
    const y = margin;
    const width = rect.width - margin * 2;
    const height = rect.height - margin * 2;
    context.lineWidth = 2;
    context.strokeStyle = isBusy ? "rgba(19, 138, 82, 0.95)" : "rgba(255,255,255,0.84)";
    context.strokeRect(x, y, width, height);
    context.strokeStyle = "rgba(255,255,255,0.32)";
    context.beginPath();
    context.moveTo(x + width / 2, y);
    context.lineTo(x + width / 2, y + height);
    context.moveTo(x, y + height / 2);
    context.lineTo(x + width, y + height / 2);
    context.stroke();
  }

  function drawEmptyResult() {
    const canvas = el.resultCanvas;
    canvas.width = CANONICAL_WIDTH;
    canvas.height = CANONICAL_HEIGHT;
    const context = canvas.getContext("2d");
    context.fillStyle = "#eef1f6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#667085";
    context.font = "48px -apple-system, BlinkMacSystemFont, sans-serif";
    context.textAlign = "center";
    context.fillText("等待识别", canvas.width / 2, canvas.height / 2);
  }

  function drawResult(output) {
    const canvas = el.resultCanvas;
    canvas.width = CANONICAL_WIDTH;
    canvas.height = CANONICAL_HEIGHT;
    const context = canvas.getContext("2d");
    context.drawImage(output.canonicalCanvas, 0, 0);
    context.lineWidth = 4;
    context.font = "24px -apple-system, BlinkMacSystemFont, sans-serif";
    context.textBaseline = "bottom";

    for (const question of output.questions) {
      const color = question.selected
        ? (question.hasAnswer ? (question.correct ? "#138a52" : "#c0362c") : "#2563eb")
        : "#667085";
      context.strokeStyle = color;
      context.fillStyle = color;
      context.strokeRect(question.bestCenterX - 22, question.bestCenterY - 14, 44, 28);
      if (question.selected) {
        context.fillText(`${question.number}${question.selected}`, question.bestCenterX - 18, question.bestCenterY - 17);
      }
    }
  }

  function updateMetrics(output) {
    if (!output) {
      el.scoreMetric.textContent = "--";
      el.recognizedMetric.textContent = "0/55";
      el.correctMetric.textContent = "--";
      return;
    }
    el.recognizedMetric.textContent = `${output.recognizedCount}/55`;
    if (output.gradedCount > 0) {
      el.scoreMetric.textContent = `${formatNumber(output.earnedPoints)}/${formatNumber(output.totalPossiblePoints)}`;
      el.correctMetric.textContent = `${output.correctCount}/${output.gradedCount}`;
    } else {
      el.scoreMetric.textContent = "--";
      el.correctMetric.textContent = "--";
    }
  }

  function renderQuestions(questions) {
    el.questionRows.replaceChildren();
    if (!questions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "还没有识别结果。";
      el.questionRows.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const question of questions) {
      const row = document.createElement("div");
      row.className = "question-row";

      const mark = document.createElement("span");
      mark.className = "tag";
      if (!question.hasAnswer) {
        mark.textContent = "-";
        mark.classList.add("miss");
      } else if (!question.selected) {
        mark.textContent = "未识别";
        mark.classList.add("miss");
      } else if (question.correct) {
        mark.textContent = "对";
        mark.classList.add("ok");
      } else {
        mark.textContent = "错";
        mark.classList.add("bad");
      }

      row.append(
        textCell(String(question.number).padStart(2, "0"), "mono"),
        textCell(question.selected || "?"),
        textCell(question.answer || "-"),
        textCell(formatNumber(question.pointValue), "mono"),
        mark,
        textCell(question.confidence.toFixed(2), "mono confidence")
      );
      fragment.append(row);
    }
    el.questionRows.append(fragment);
  }

  function saveCurrentResult() {
    const output = state.lastOutput;
    if (!output) {
      return;
    }
    addHistoryItem(output);
    renderHistory();
    setStatus("当前结果已保存。", "good");
  }

  function addHistoryItem(output) {
    const item = {
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      score: output.gradedCount > 0 ? `${formatNumber(output.earnedPoints)}/${formatNumber(output.totalPossiblePoints)}` : "--",
      recognized: `${output.recognizedCount}/55`,
      correct: output.gradedCount > 0 ? `${output.correctCount}/${output.gradedCount}` : "--"
    };
    const last = state.history[0];
    if (last && last.score === item.score && last.recognized === item.recognized && last.correct === item.correct) {
      return;
    }
    state.history.unshift(item);
    state.history = state.history.slice(0, 30);
    localStorage.setItem("answer-card.history", JSON.stringify(state.history));
  }

  function clearHistory() {
    state.history = [];
    localStorage.removeItem("answer-card.history");
    renderHistory();
  }

  function renderHistory() {
    el.historyRows.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "暂无保存记录。";
      el.historyRows.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of state.history) {
      const row = document.createElement("div");
      row.className = "history-row";
      row.append(
        textCell(item.time, "mono"),
        textCell(`得分 ${item.score}，正确 ${item.correct}`),
        textCell(item.recognized, "mono")
      );
      fragment.append(row);
    }
    el.historyRows.append(fragment);
  }

  function textCell(value, className = "") {
    const span = document.createElement("span");
    span.textContent = value;
    if (className) {
      span.className = className;
    }
    return span;
  }

  function setStatus(message, tone = "") {
    el.statusText.textContent = message;
    el.statusText.className = `status-text ${tone}`.trim();
  }

  function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cleanMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      image.src = url;
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }
})();
