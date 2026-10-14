## RAG evaluation results

Test set: 30 in-scope questions with hand-verified gold locations, 10 off-material questions. Generator: `openai/gpt-oss-120b`, retrieval top-k = 6, gate distance = 0.27.

| Metric | Value |
| --- | --- |
| Retrieval hit@6 (gold source among retrieved) | 96.7% |
| Retrieval MRR | 0.762 |
| In-scope questions answered (1 - false refusal) | 100.0% |
| Answers with at least one correct citation | 93.3% |
| Citation precision (lower bound; gold is not exhaustive) | 56.9% |
| Refusal accuracy, all off-material | 100.0% |
| Refusal accuracy, unrelated | 100.0% |
| Refusal accuracy, near-topic | 100.0% |
| Retrieval hit@6, figure questions | 100.0% |
| Retrieval hit@6, slide questions | 91.7% |
| Retrieval hit@6, text questions | 100.0% |
| Retrieval hit@6, video questions | 100.0% |

RAGAS (judge `qwen/qwen3.8-27b`):

| RAGAS metric | Mean | Scored | Failed |
| --- | --- | --- | --- |
| faithfulness | 0.946 | 12 | 3 |
| answer_relevancy | 0.912 | 13 | 2 |
| context_precision | 0.784 | 13 | 2 |
| context_recall | 0.917 | 12 | 3 |

### Failure cases (2 of 30 in-scope questions)

- q18 (gold source not retrieved): What do keys() and values() give you for a dictionary?  | gold: slide 47 | cited: slide 48
- q29 (cited source not in gold): How is mathematical induction related to checking that recursive code works?  | gold: slide 14, slide 15, slide 16, slide 17 | cited: video 1180, video 1032, video 1131

### Off-material questions that were answered instead of refused (0)


Caveats: gold locations were hand-verified but are not exhaustive; the RAGAS judge is an LLM and noisy on small samples; numbers are from a single run on one course unit.