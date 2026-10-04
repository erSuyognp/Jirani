# Qualitative holdout: Kenyan leaves

`ml/holdout/ke/` is where photos of **Kenyan** coffee leaves go: SL28, SL34 or Ruiru 11, taken the way the app asks
(one detached leaf, lower side up, in a leaf box on the printed capture card).

The folder is empty in the repository. Nothing in the app, the training code or the evaluation reads it, so the app
behaves the same whether it is empty or full.

## Rules

- **Never used for training, validation, calibration or choosing tau.** The shipped model is trained on BRACOL
  (Brazil) only. See [DATA.md](../../DATA.md).
- **Qualitative only.** The photos are for one slide: "this is what the tool says on a few Kenyan leaves". A handful
  of photos cannot give an accuracy number, so do not report one from this folder.
- **Show the refusals too.** If the tool says "Not sure" on a Kenyan leaf, that goes on the slide as well.
- Photos need the photographer's permission and a note of where they were taken and of which variety.

## Layout

```
ml/holdout/ke/
  SL28/        one folder per variety
  SL34/
  Ruiru11/
  notes.csv    file, variety, date, place, who took it, what a person says is on the leaf (if known)
```

## How to run the tool on them

Open the farmer app, choose **Gallery** on the capture screen, and pick three photos of leaves from the same block.
Take a screenshot of the result card. No script is provided on purpose: these photos must not drift into the
evaluation numbers.
