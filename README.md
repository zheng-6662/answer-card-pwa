# 答题卡改卷 PWA

这是 iPhone Safari 可用的网页应用版本。部署到 HTTPS 静态网站后，手机直接打开网址即可使用，不需要安装 IPA，也不需要电脑连接手机。

## 当前功能

- iPhone 后置相机连续扫描。
- 从相册选择照片识别。
- 正确答案可设置。
- 当前正确答案已按老师提供内容预置，使用时不用再输入答案。
- 每题分值已预置：1-20 每题 1.5 分，21-40 每题 2.5 分，41-55 每题 1 分。
- 手机本机识别，不上传图片。
- 显示得分、识别题数、正确题数和每题明细。
- 可保存最近成绩记录。
- 完整扫描成功后自动停止扫描、跳到成绩区，点击“下一份扫描”继续下一张。
- 加入选择框网格校验，扫到键盘、桌面、显示器，或者裁剪错位时不再出分。
- 支持添加到 iPhone 主屏幕。

## 必须说明

苹果手机打开相机要求页面处于安全环境，也就是：

- `https://` 网址可以；
- 本机 `localhost` 可以；
- 普通 `http://` 或直接打开本地 HTML 文件不可以。

所以“真正不用电脑”指的是：发布成一个 HTTPS 网址之后，日常使用时只需要手机打开网址。第一次发布仍然需要一个静态网站托管平台，例如 Cloudflare Pages、Netlify、Vercel 或 GitHub Pages。

## 目录

```text
answer_card_pwa/
  index.html
  styles.css
  app.js
  manifest.webmanifest
  service-worker.js
  assets/
```

## GitHub Pages 发布方式

推荐新建一个公开仓库，例如：

```text
answer-card-pwa
```

然后把本目录里的这些内容上传到仓库根目录：

```text
.nojekyll
index.html
styles.css
app.js
manifest.webmanifest
service-worker.js
assets/
```

注意：不要只上传 zip 文件。GitHub Pages 需要看到解压后的 `index.html` 和其它文件。

上传后，在 GitHub 仓库里设置：

1. 打开仓库。
2. 进入 Settings。
3. 左侧进入 Pages。
4. Build and deployment 里，Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`。
6. Folder 选择 `/root`。
7. 点击 Save。

等待 1-3 分钟，GitHub 会生成网址：

```text
https://你的用户名.github.io/仓库名/
```

例如：

```text
https://yourname.github.io/answer-card-pwa/
```

用 iPhone Safari 打开这个网址，点击“开始扫描”，允许相机权限即可。

## 其它发布方式

把整个 `answer_card_pwa` 文件夹发布到任意 HTTPS 静态托管平台即可。发布后用 iPhone Safari 打开网址，允许相机权限。

如果要放到 Cloudflare Pages：

1. 登录 Cloudflare。
2. 进入 Workers & Pages。
3. 创建 Pages 项目。
4. 选择直接上传。
5. 上传 `answer_card_pwa_site.zip`。
6. 发布后得到一个 `https://...pages.dev` 地址。

如果要放到 Netlify：

1. 登录 Netlify。
2. 进入 Sites。
3. 选择手动部署。
4. 上传 `answer_card_pwa_site.zip`。
5. 发布后得到一个 `https://...netlify.app` 地址。

## iPhone 使用

1. 用 Safari 打开发布后的 HTTPS 网址。
2. 点“开始扫描”。
3. 允许相机权限。
4. 输入标答和分值。
5. 对准答题卡，等待自动刷新结果。
6. 需要像 App 一样打开时，点 Safari 分享按钮，然后点“添加到主屏幕”。

## 当前预置标答

```text
1-5 CBAAC
6-10 CCAAC
11-15 CCBBC
16-20 BBBAA
21-25 ADBCA
26-30 BCBDD
31-35 ADCAD
36-40 BECAD
41-45 CDABB
46-50 CDAAD
51-55 BDACB
```

## 当前预置分值

```text
1-20:1.5 21-40:2.5 41-55:1
```

## 批量扫描流程

1. 点击“开始扫描”。
2. 把完整答题卡放入画面。
3. 完整识别成功后，页面自动停止扫描并跳到成绩区。
4. 查看分数。
5. 点击“下一份扫描”继续下一张。

## 识别限制

当前版本按你给的 55 题答题卡模板识别。拍摄时尽量让答题卡完整进入画面、纸张边框不要严重缺失、光线均匀。页面会检查选择框网格是否对齐；如果画面里只有局部答题卡、旁边有键盘/屏幕/大块黑边，或者选项框网格没有对齐，会提示重新扫描，不会出分。极端倾斜、遮挡、强阴影会影响准确度。
