# Greasy Fork 首次发布与更新

仓库已经准备好可直接导入的发布文件；**首次发布仍需仓库所有者登录 Greasy Fork 创建脚本**。本文件不是已发布成功的记录。取得实际脚本地址后，将它补到 README 的安装入口。

## 首次发布（只做一次）

1. 登录 [Greasy Fork](https://greasyfork.org/zh-CN/users/sign_in)，可使用 GitHub 登录。
2. 打开 [导入脚本](https://greasyfork.org/zh-CN/import)，填写以下 URL，语言选择 JavaScript，同步方式选择 **自动**，提交导入：

   ```text
   https://raw.githubusercontent.com/dakokili/MWIindex/main/mwi-profit-indices.user.js
   ```

   必须使用 `main` 分支地址，不要填某次提交的 SHA 地址；后者永远不会获取后续修改。
3. 在脚本页面检查名称、版本和适用网站；设置内容语言为简体中文，将 [发布页说明](greasyfork-description.md) 的正文作为详细介绍（Markdown）。按照页面提示完成首次发布。
4. 将生成的 **Greasy Fork 脚本详情页链接** 发给用户。用户安装 Tampermonkey 后，点击页面上的“安装此脚本”，再在扩展窗口确认，即可安装。
5. 原来从 GitHub 或粘贴代码安装的用户，建议通过该 Greasy Fork 页面重新安装一次，以建立 Greasy Fork 更新来源。保持 `@name` 和 `@namespace` 不变，并检查扩展中没有同时启用两份脚本。

本仓库不伪造尚未分配的 Greasy Fork 脚本 ID。发布后把真实链接补入 README 即可。

## 以后如何推送更新

```bash
npm version patch --no-git-tag-version
npm run check
# 将源码、package.json、package-lock.json 和重新构建的 .user.js 一并提交。
git add <本次修改的文件>
git commit -m "Describe the release"
git push origin HEAD:main
```

- `package.json` 是唯一版本来源，构建元数据与界面导出均读取它。功能升级也可使用 `npm version minor --no-git-tag-version`。
- Greasy Fork 按同步设置拉取 main 上的新版本，用户的脚本管理器再按各自更新设置检查和安装新版。这不是即时强制推送，用户需要启用脚本自动更新。
- 保留同一个 Greasy Fork 发布页，不要每次新建脚本；每次代码改变都递增 `@version`。
- 从 Greasy Fork 安装的脚本由该站提供更新渠道。构建文件不写 `@updateURL` / `@downloadURL`，也不在运行时自行下载、执行新代码。
- GitHub Actions 会检查单元测试、元数据、文件大小、版本递增和发布文件是否与源码一致；它**不会创建 Greasy Fork 发布页，也不会阻止已开启的同步**。因此推送 main 前仍应先通过本地 `npm run check`。

## 可选：推送后立即通知 Greasy Fork

自动同步已经可以使用。若要减少等待，可在首次导入完成后配置官方 GitHub Webhook：

1. 登录并打开 [Greasy Fork Webhook 设置说明](https://greasyfork.org/zh-CN/users/webhook-info)，取得该账号专属的 Payload URL / Secret（以页面实际字段为准）。
2. 打开 [MWIindex 的 Webhooks 设置](https://github.com/dakokili/MWIindex/settings/hooks)，按 Greasy Fork 页面说明创建 GitHub Webhook，使用 `application/json`，选择 push 事件。
3. 保持脚本同步 URL 指向上面的 raw main 文件。后续提交新版本时，检查 GitHub Webhook 的 Recent Deliveries 与 Greasy Fork 页面版本，确认同步成功。

这些账号专属字段仅填入站点设置，不写入公开仓库。用户端仍由 Tampermonkey 自己的更新检查决定何时更新。

## 发布前核验与常见问题

- `npm run check`：模型测试、构建、发布检查和 Chromium 集成测试。
- `RELEASE_BASE_SHA=<上个提交的完整SHA> npm run release:check`：额外验证脚本变化时版本确实递增。
- 不更新：检查是否修改了版本、是否提交了构建文件、同步 URL 是否指向 main，以及 Greasy Fork 管理页同步错误；再检查用户端自动更新设置。
- 无法安装：确认用户脚本扩展已启用，并在扩展安装窗口确认；浏览器直接显示源码通常说明扩展没有接管安装。
- 已有版本需要修复：以更高版本发布修复，不降低版本号。

核验依据（2026-10-14）：[Greasy Fork 元数据规则](https://greasyfork.org/en/help/meta-keys)、[代码规则](https://greasyfork.org/en/help/code-rules)、[API 与 Webhook 说明](https://greasyfork.org/en/help/api)、[官方导入页面实现](https://github.com/greasyfork-org/greasyfork/blob/main/app/views/import/index.html.erb)。
