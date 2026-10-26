# Giftwise vs. plain gpt-6-luna ("just ask ChatGPT")

Run 2026-10-26. 6 test people, same profile, date and budget given to both. Checked by code (`eval/compare.py`).

| Check | Plain gpt-6-luna | Giftwise |
|---|---|---|
| Suggestions | 30 | 14 |
| **With any problem** | **2** | **0** |
| Suggests something they dislike | 0 | 0 |
| Repeats a past gift | 0 | 0 |
| Over budget | 0 | 0 |
| Custom/handmade with < 10 days left | 2 | 0 |
| No specific store to buy from | 0 | 0 |
| Comes with a link to order it | 0 | 14 |
| Cost of all 6 runs | $0.0015 | $0.0100 |

## Every flagged suggestion

- **Plain** · Mom (2 days, $60, dislikes candles): "A handmade ceramic mug or small bowl from a local potter—choose one in a glaze she’d love" $45.0 → too_late
- **Plain** · Dad (6 days, $80, dislikes socks, ties): "Personalized leather golf scorecard holder" $45.0 → too_late

## Reading this honestly

- The baseline was given the person's full profile (likes, dislikes, past gifts, wishlist) typed out in the prompt. With everything spelled out, a modern model mostly respects it; Giftwise's edge is that it **remembers** all of this (no retyping), checks dislikes/repeats/budget **in code**, only searches delivery windows that can still arrive, and links every pick to a real store or a real nearby shop.
- `too_late` is a keyword check (custom, personalized, handmade, engraved...) with under 10 days left; a handmade item bought in person could still work.
- Model output varies run to run; this is one run of 6 cases, not a statistical study.
- Giftwise costs more per search (several agents) but both are fractions of a cent.
