# Language rules — the reasoning behind `conventions.json`

The data lives in [`server/config/conventions.json`](../server/config/conventions.json). It is
data only, on purpose. This page is why it exists, what it has already got wrong, and what you
need before adding a language.

## What the file is for

**Typographic conventions the target language requires regardless of what the source did.**

English has no opening question mark. A translator that faithfully mirrors the source's
punctuation is therefore *wrong* in Spanish — and nothing structural notices, because the
placeholders are intact, the pipes are intact and the words are right.

Measured 2026-07-27: **qwen3:8b missed the opening `¿` on 5 of 5 questions**, and lingo.dev's run
missed 5 of 5 too. Both had the rule in their system prompt.

## Two halves, one table

Each language entry carries exactly two fields, consumed by two different layers:

| field | shape | who reads it |
|---|---|---|
| `promptLine` | one clause | spliced into the system prompt's rule list — `translate.js` → `loop.js` |
| `pairedPunct` | `[[opener, closer], …]` | the `startpunc` and `spurious-interrogative` checks — `checks.js` |

`promptLine` **tells the model**. `pairedPunct` **checks whether it listened.** Delete a language
block and that language silently loses both.

What `pairedPunct` asserts: a sentence in the target that ends in `closer` must contain `opener`;
and a target that opens `opener` when the source never had `closer` is an invented question.

## Spanish only, deliberately

Other languages have their own rules — French's spaced punctuation, German's quotation marks,
CJK full-width forms — and **writing them from memory is exactly how a confident wrong rule ends
up applied to every future translation.** A language is added when someone who knows it says what
the rule is.

## The scar: a rule that worked, and kept working where it should have stopped

The first version of the Spanish `promptLine` said a question *"must open with ¿ … including when
the sentence begins mid-string"* and stopped there.

Measured on the full 846-key catalogue, 2026-07-27: it produced **72 `¿` against 16 real
questions — 56 spurious.** The button "Try tutorial project" became "¿Probar proyecto de
tutorial?" and the card title "Statuses" became "¿Estados?".

Missed openings were **0 of 16**. The rule worked perfectly and then kept applying itself
everywhere else. The 40-key corpus never caught it — too few imperative labels.

**A convention rule must say when NOT to apply**, because a model told half a rule applies it
everywhere. That is why the shipped `promptLine` ends with *"Apply this ONLY when the English is
itself a question or exclamation … Never turn a statement into a question."*

`checkSpuriousPunc` in `checks.js` exists because of this incident — the cure caused the disease,
so there is now a check for the cure.

## Adding a language — read this first

`promptLine` generalises to anything: it is a sentence for the prompt.

**`pairedPunct` does not.** It can only express *"the target needs an opening mark the source does
not have."* That shape fits Spanish, and it does not fit everything:

| language | its main rule | expressible today? |
|---|---|---|
| Spanish | `¿ … ?` and `¡ … !` | **yes** — the shape was built for it |
| German | `„ … "` quotation marks | **probably** — it is genuinely a paired open/close |
| French | narrow no-break space *before* `? ! : ;` | **no** — there is no opening mark to pair |
| CJK | full-width forms (`？` not `?`) | **no** — it is a substitution, not a pair |

So French and CJK need a **new rule type and a new check**, not just a new row. Adding a
`promptLine` for them is possible today; adding verification is not. Do not add a language's
`pairedPunct` by analogy — if the rule is not literally "this opener must precede that closer",
the schema needs extending first.
