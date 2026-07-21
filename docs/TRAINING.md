# Training a custom ball detector

The built-in detector is classical CV: color and shape based, real-time on Apple Silicon, and genuinely fine on an evenly lit table with nothing but balls on the cloth. Where it struggles is everything a real practice session throws at it: hands reaching in, a cue lying across the table, shadows from a player leaning over, lighting that changes with the time of day. A small trained detector buys robustness to all of that. There is no urgency; run classical until it annoys you.

## The path

**1. Collect frames.** `GET /api/camera/snapshot.jpg` returns the current frame, so a loop hitting that endpoint every few seconds during real sessions builds a dataset for free. Deliberately capture variety: different rack states, hands in frame, cue on the table, lights on and off, daytime and evening. A few hundred varied frames beats thousands of identical ones.

**2. Label.** Roboflow or Label Studio, whichever is less friction. Draw a box per ball and label the number (cue, 1-15). Ball class matters because game logic needs identity, not just position.

**3. Train.** A small detector is enough; the problem is 16 classes of uniform spheres on a flat surface, about as easy as object detection gets. RF-DETR small is a good fit, and it already runs on the studio Mac mini for the sidewalk counter project, so the toolchain and the hardware are proven. Fine-tune from a pretrained checkpoint; a few hundred labeled frames should get usable results.

**4. Export to ONNX.** Keeps inference portable across the Mac mini today and an Nvidia box later if frame rate ever demands it.

**5. Plug it in.** The vision engine was built with a pluggable detector seam for exactly this. Implement the detector interface described in the contract (frames in, per-ball detections with position and class out) and the rest of the pipeline, tracking, table-space mapping, game logic, does not change at all. Swap detectors in config and A/B against classical on the same table.

## Expectations

The trained model is an upgrade in robustness, not a prerequisite. Classical detection on a well-lit table already scores games correctly. Do the lighting work in SETUP.md first; it improves both detectors and it is cheaper than labeling.
