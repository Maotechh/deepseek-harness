---
description: "在显式声明插件的 lab 配置中使用持久对话、业务预览工具和本地语音识别。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-lab-copilot

[English](README.md) | 中文

## 概述

教师可以通过校园网站查询实验室记录、生成待确认的业务预览，并识别录音文字。本组件组合将网站连接到 DSH 持久对话及实验室技能。模型使用学校接口，语音识别使用官方本地 SenseVoice 组件。业务服务器负责校验与执行，模型没有确认执行工具。

## 目录

- [使用本组件](#use-this-package)
- [实现说明](#understand-the-implementation)
- [相关资料](#further-exploration)
- [模型输入](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本组件

请使用显式创建的空配置，在其 `package.json` 中写入 `"dsh":{"profile":{"bundles":[]}}`。CLI 自动创建的配置默认包含通用 base 组件组合，会与本独立组合冲突。在源码目录中，将 `DSH_HOME` 设置为该自定义目录，再执行以下命令安装本地组件。

```sh
pnpm dsh plugin --profile lab add ./packages/experimental/lab-copilot
pnpm dsh --profile lab
```

本地路径安装会创建工作区链接，pnpm 可能显示 peer dependency 警告。空配置只会激活本组件组合。使用 `pnpm dsh plugin --profile lab remove @deepseek-ai/dsh-lab-copilot` 可以移除。生产部署应当安装固定版本的依赖文件，不能依赖开发者的源码目录。

接口仅监听 `127.0.0.1`，默认端口为 `8766`。`GET /health` 返回接口与语音准备状态。业务服务器通过 `POST /runs` 发送任务，通过 `POST /runs/<runId>/cancel` 取消，通过 `POST /voice` 发送仅在内存中处理的 WAV 录音。此配置不提供通用 shell、文件、网络、安装、遥测或远程会话上传工具。

设置绝对路径 `LAB_DSH_STATE`，可以将会话事件、图片附件和语音缓存与可替换的配置目录分开。未设置时，这些文件保存在 `DSH_HOME` 中。`LAB_VOICE_MODEL_DIR` 和 `LAB_VOICE_VAD_PATH` 指定预先安装的本地模型；`LAB_CALLBACK_URL` 和 `LAB_DSH_PORT` 设置本机接口。学校模型地址在配置文件的模型定义中显式设置。业务调用必须携带对应运行的令牌，地址必须是服务器本机。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>维护者说明</summary>

[配置文件](cordis.patch.yml) 显式声明完整插件清单。[接口实现](src/index.ts) 为每个业务对话创建或恢复一个会话，只注册校内工具并转发经过校验的调用。成功生成预览后，模型本轮处理结束。取消操作覆盖会话创建、推理及等待中的工具；组件卸载会等待已接受的任务结束。同一对话的并发运行会被拒绝，业务服务器负责排队及持久消息的幂等处理。

</details>

-----

<a id="further-exploration"></a>
## 相关资料

[会话持久化](../../session/session-persistence-jsonl/README.zh.md)与[本地语音识别](../speech-to-text-sensevoice/README.zh.md)分别说明存储及识别组件。

-----

<a id="model-experience"></a>
## Model Experience

### 实验室操作说明

#### What the model sees

每次运行包含业务服务器编写的实验室规则和教师提交的消息。接口会附加以下固定技能加载说明。`load_skill` 将选中的技能作为普通工具结果返回；上传的图片由附件组件处理。模型可见内容全部保留在对应的会话事件中。

##### 技能加载说明

```markdown
Load the matching skill before business work with load_skill. Available skills: inventory, loans, experiment-preparation, purchasing, counting-maintenance, attachments, reminders.
```

#### Token effect

提交的文字、规则、图片表示、工具定义及已加载的技能正文都会占用模型输入。后续运行继续使用已保存的对话历史。

#### KV Cache effect

未修改的规则和已有历史可以复用相同前缀。服务器规则或工具定义变化后，从首个变化位置开始的前缀将发生变化。

### 业务工具

#### What the model sees

工具接受 JSON `arguments` 对象，并返回业务服务器生成的 JSON。`business_preview` 校验计划但不执行；返回 `pending_confirmation` 时结束本轮处理。任何工具都不能批准或执行计划。业务接口失败或运行超过限制时，返回失败状态，不宣称业务已经执行。

#### Token effect

每次调用的参数与结果都会加入历史。单次运行最多允许四十次工具调用，技能加载也计算在内，运行时间最多五分钟。

#### KV Cache effect

工具调用与结果追加到持久历史中，不替换已有业务结果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 业务服务器必须校验每项预览、确认和工具调用。服务器本机通信不代表已经获得授权。
- 模型错误仍可能需要教师补充说明或继续处理。运行限制不能将未完成的任务变为成功的业务操作。
- 实际麦克风权限、证书信任与手机后台通知由部署的网站负责，必须在实际设备上验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护上下文</summary>

无。

</details>
