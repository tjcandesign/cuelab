# Calibration

Calibration maps two devices into table space (millimeters on the playing surface): the camera, so detected balls land at real coordinates, and the projector, so graphics drawn in millimeters land on the right spot of cloth. The wizard in the web app walks through three steps. In sim mode the synthetic camera renders perspective-distorted frames, so you can run the whole wizard with no hardware and see exactly what the real flow looks like.

Calibration survives restarts. You only redo it when something physically moves.

## Step 1: Camera

The wizard shows a snapshot from the camera. Click the four corners of the **playing surface** (the cloth inside the cushions, not the rails) in this order: top-left, top-right, bottom-right, bottom-left. The server solves the camera-to-table homography from those four points and shows a corrected top-down preview.

Check the preview. It should look like a clean rectangle with the cloth filling the frame edge to edge. If the corners you clicked were right, straight rails come out straight and the geometry is done; lens distortion at the edges is normal for wide-angle cameras and is fine as long as the corners land correctly.

## Step 2: Projector

Open `/projector?calibrate=1` in a browser window on the projector display (drag it to that screen and fullscreen it). It shows a table outline with four draggable corner handles. Stand at the table and move each handle, by dragging or with the arrow keys for fine steps, until the projected outline sits exactly on the edges of the playing surface. Arrow keys are worth using for the last few millimeters; a pixel is about 1.2 mm at table scale.

Press `b` to toggle live ball outlines. With balls on the table (or sim balls placed from the control screen), the outlines should ring each ball. If they do, camera and projector agree end to end.

## Step 3: Verify

The system projects markers at known table positions, finds them with the camera, and reports the offset at each point in millimeters. A few millimeters of error is normal and invisible in play. In sim mode this step is simulated and returns a pass.

## Troubleshooting

**Preview not rectangular after the warp.** The corners were clicked in the wrong order or on the rails instead of the cloth. Redo step 1, order is TL, TR, BR, BL, and click the inside edge of the cushions.

**Projection drifts over days.** The mount is moving. Calibration data does not decay; if graphics that used to line up no longer do, something physical shifted. Check the projector mount for sway or loosened hardware, retighten, recalibrate once.

**Balls detected at the wrong size or position.** The camera homography is stale, usually because the camera got nudged. Redo the camera step. If sizes are wrong across the whole table, also confirm the table preset in config matches the actual table.

**Glare spots in the camera view.** A specular reflection from a light washes out detection wherever it sits. Re-angle the perimeter lights so no fixture reflects into the lens. Matte (non-glossy) cloth helps a lot; new shiny cloth is the worst case.
