# Craft sources

`src/lessons.ts` carries two kinds of rules besides the lessons from our own mistakes:
`CRAFT_RULES` (how good images are described to a model) and the later entries in `COMPOSITING_RULES`
(how real text and logos are set over generated art). Every one is a short paraphrase of a principle,
written in our own words; nothing is copied. These are the sources, researched on 2026-10-11.

| Source | Licence | Official | What it contributed |
|---|---|---|---|
| [OpenAI GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) | OpenAI Cookbook (MIT repo) | Yes | Brief-style prompts with audience and placement, change-only-X edits. |
| [Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana) | Google | Yes | Narrative over keywords, positive framing, materials, colour grade, lighting. |
| [How to prompt Gemini 2.5 Flash Image](https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/) | Google | Yes | Context and intent first, semantic negative prompts. |
| [Veo prompt guide, Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide) | Google, CC BY 4.0 text | Yes | Camera moves, lens and focus terms, audio written separately. |
| [Veo prompt guide, DeepMind](https://deepmind.google/models/veo/prompt-guide/) | Google | Yes | Shot framing and camera motion. |
| [Anthropic skills: frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 | Yes (Anthropic) | Restraint, generated-look defaults to avoid, audience vernacular, typographic tells. |
| [Anthropic skills: canvas-design](https://github.com/anthropics/skills/tree/main/skills/canvas-design) | Apache-2.0 | Yes (Anthropic) | Type as part of the artwork. |
| [nano-banana-image-skill](https://github.com/Emily2040/nano-banana-image-skill) | Apache-2.0 | No (community) | Lighting stack, material stack, lens by mood. |
| [NN/g, Visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | NN/g | No (research firm) | At most two large elements, contrast drives attention. |
| [NN/g, Text over images](https://www.nngroup.com/articles/text-over-images/) | NN/g | No (research firm) | Scrims and blur, 4.5:1 and 3:1 contrast. |
| [Practical Typography, letterspacing](https://practicaltypography.com/letterspacing.html) | Matthew Butterick | No (typography reference) | Tracking on caps and large headlines. |
| [Think with Google, YouTube ABCDs](https://business.google.com/en-all/think/future-of-marketing/youtube-video-ad-creative/) | Google | Yes (ad research) | Attract early, brand early, one message, clear next step. |
| [Confect, safe zones](https://confect.io/ad-glossary/safe-zones) | Confect | No (secondary) | Stories and Reels UI overlap. Meta's own page wasn't reachable, so check the exact percentages against Meta's current specs. |

Looked at and not used: Anthropic's brand-guidelines skill (Anthropic's own brand only), a large AI
image prompt gallery (examples, not principles), and a small repackaging of the OpenAI guide (the guide
itself is cited instead).
