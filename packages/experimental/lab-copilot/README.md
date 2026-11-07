---
description: "Enable persistent campus laboratory chat, preview tools and local speech recognition in an explicit lab profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-lab-copilot

English | [中文](README.zh.md)

## Summary

Teachers can query laboratory records, prepare changes for confirmation and transcribe recordings through a campus website. This bundle connects the website to persistent DSH conversations and packaged laboratory skills. It uses the institution’s model and the official local SenseVoice components. The business server owns validation and execution; the model has no confirmation tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use an explicitly empty custom profile whose `package.json` contains `"dsh":{"profile":{"bundles":[]}}`. A newly initialized CLI profile otherwise includes the general base bundle, which conflicts with this standalone composition. From a source checkout, install the local package with the following command after setting `DSH_HOME` to that custom home.

```sh
pnpm dsh plugin --profile lab add ./packages/experimental/lab-copilot
pnpm dsh --profile lab
```

The local-path install creates a workspace link and can print pnpm’s peer-dependency warning. It activates only this bundle in the empty profile. Remove it with `pnpm dsh plugin --profile lab remove @deepseek-ai/dsh-lab-copilot`. Production deployment must install the pinned dependency payload rather than depend on a developer checkout.

The gateway listens only on `127.0.0.1`; its configured port defaults to `8766`. `GET /health` reports the gateway and speech preparation state. The business server sends runs to `POST /runs`, cancellation to `POST /runs/<runId>/cancel`, and memory-only WAV recordings to `POST /voice`. The profile exposes no general shell, filesystem, network, installation, telemetry or remote Session-upload tool.

Set `LAB_DSH_STATE` to an absolute persistent directory to separate Session events, image attachments and speech cache from the replaceable profile home. If omitted, these files remain under `DSH_HOME`. `LAB_VOICE_MODEL_DIR` and `LAB_VOICE_VAD_PATH` select preinstalled local models; `LAB_CALLBACK_URL` and `LAB_DSH_PORT` configure the local endpoints. The school model URL is an explicit provider setting in the patch. Business callbacks require the run-specific token and a loopback address.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details</summary>

The [patch](cordis.patch.yml) declares the complete plugin list. The [gateway](src/index.ts) creates or resumes one Session per business conversation, registers only campus tools and forwards validated callbacks. A successful preview ends the model turn. Cancellation owns creation, inference and pending tools; disposal waits for accepted runs. Concurrent runs for one conversation are rejected, while the business server owns queueing and durable message idempotency.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Session persistence](../../session/session-persistence-jsonl/README.md) and [local speech recognition](../speech-to-text-sensevoice/README.md) describe the underlying storage and recognizer.

-----

<a id="model-experience"></a>
## Model Experience

### Laboratory instructions

#### What the model sees

Each run supplies server-owned laboratory instructions and the teacher’s submitted message. The gateway appends the fixed skill-loading instruction below. `load_skill` returns the selected packaged workflow as an ordinary tool result; uploaded pictures enter through the attachment service. All model-visible content is retained in the corresponding Session events.

##### Skill-loading instruction

```markdown
Load the matching skill before business work with load_skill. Available skills: inventory, loans, experiment-preparation, purchasing, counting-maintenance, attachments, reminders.
```

#### Token effect

The submitted text, instructions, image representation, tool definitions and loaded skill bodies contribute to the model request. Persisted conversation history is reused on later runs.

#### KV Cache effect

Unchanged instructions and earlier history can retain their prefix. A changed server prompt or tool definition changes the prefix from its first changed position.

### Business tools

#### What the model sees

Tools accept a JSON `arguments` object and return JSON from the business server. `business_preview` validates a proposed change without executing it; a `pending_confirmation` result ends the turn. No tool can approve or execute a plan. A failed callback or a run limit produces a failure rather than an execution claim.

#### Token effect

Each call appends its arguments and result to history. One run permits at most forty tool calls, including skill loading, and five minutes of execution.

#### KV Cache effect

Tool calls and results append to the persisted history without replacing earlier business results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The business server must validate every preview, confirmation and callback. Loopback transport alone is not authorization.
- Model errors can still require a teacher to clarify or continue. Limits do not turn an incomplete run into a successful business operation.
- Real microphone permissions, certificate trust and mobile background notifications belong to the deployed website and require actual device checks.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

None.

</details>
