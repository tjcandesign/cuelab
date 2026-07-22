# Hardware setup

Buying and rigging guide for a real-table install. Written for the Taoti studio but the math applies anywhere. Nothing here is exotic: a short-throw projector, a cheap webcam, some LED shop lights, and a rigid mount. Budget roughly $400-700 total if you buy used.

## Projector

The projector mounts directly above the table pointing straight down, so the image it throws has to cover the whole playing surface from whatever height the ceiling allows. The controlling number is throw ratio, which is throw distance divided by image width:

```
image width = mount height / throw ratio
```

Worked example for the default 8ft table. The playing surface is 88 x 44 inches. Say the lens ends up 65 inches (5' 5") above the slate, which is typical under a 9-10 ft ceiling once the mount and the table height are subtracted. To throw an 88 inch wide image from 65 inches away you need a throw ratio of 65 / 88 = 0.74 or less. Build in a little margin for mount placement and lens position and shop for **throw ratio <= ~0.72**, which means a short-throw unit. A standard-throw projector (ratio 1.2-1.5) would need to hang 10+ feet up and is a non-starter under normal ceilings.

Good candidates: BenQ TH671ST (0.69-0.83, use the wide end) or ViewSonic PS502W (~0.49). Used units are completely fine for this, the projector only ever shows lines and text on black, and they typically run $250-500 on eBay or Facebook Marketplace. 1080p is plenty; at table scale one projector pixel is about 1/20 of an inch.

Aim for 3000+ lumens if the room has ambient light. The projector page renders on pure black, and black projects as nothing, so contrast against the cloth is what matters, not resolution.

## Lighting

A traditional center pool table light hangs exactly where the projector needs to be, and it blasts glare straight down into the camera. Take it down. The cheap replacement is two or four LED shop/garage lights (the $20-30 linkable 4ft kind) mounted around the perimeter of the table, a foot or two outside the rails, angled slightly inward. That gives the camera even, diffuse illumination across the cloth with no hot spot in the middle, which is exactly what the classical ball detector wants. Even lighting matters more than bright lighting.

## Camera

Any 1080p USB webcam under $100 works. The detector is classical CV, so there is no special camera requirement beyond seeing the whole playing surface in focus.

Mount it right next to the projector, looking straight down. To check whether a given camera covers the table from your mount height:

```
footprint = 2 x height x tan(FOV / 2)
```

At 65 inches up, covering the 88 inch long side needs a horizontal FOV of at least 2 x atan(88 / (2 x 65)) = 68 degrees. A Logitech C920 (78 degrees diagonal, ~70 horizontal) just barely makes it and leaves no margin, so a wide-angle board camera is the safer buy: the ELP wide-angle USB modules (90-120 degree lenses, ~$40-60) cover the table with room to spare, and lens distortion is absorbed by the camera calibration step. A Wyze cam flashed with RTSP firmware also works if you would rather run it over the network; point the camera source in config at the RTSP URL instead of a USB index.

The wizard handles the rest. The camera does not need to be perfectly centered or square, it just needs the full playing surface in frame.

## Compute

The built-in detector is classical CV and runs real-time on Apple Silicon, so the Taoti Mac mini is enough to start. It is already on all the time for the other camera projects, and CueLab runs fully offline, so nothing else is needed. An Nvidia box only enters the picture later, if and when a learned detector needs high-FPS GPU inference (docs/TRAINING.md covers that path).

## Mounting

- Projector plumb over the table center, lens pointing straight down. A small offset or tilt is fine because keystone calibration absorbs it, but start as close to plumb as you can so the corrected image wastes the fewest pixels.
- The mount must be rigid. Any sway, from HVAC, footsteps upstairs, or a bumped conduit, shows up as projection drift and forces recalibration. Unistrut or a proper ceiling projector mount bolted to structure, not a hook and a strap.
- Camera on the same rigid mount as the projector, so if anything ever does shift, they shift together.
- Keep the projector's exhaust clear; it will run for hours at a time.

## Checklist

- [ ] Measure lens-to-slate height, confirm throw ratio math before buying
- [ ] Projector mounted plumb over table center, bolted to structure
- [ ] Camera beside projector, whole playing surface visible in the snapshot (`/api/camera/snapshot.jpg`)
- [ ] Center table light removed, perimeter LED lights up and angled inward
- [ ] No glare hot spots visible in the camera snapshot
- [ ] HDMI to projector, USB (or network for RTSP) to camera, power to everything, cables strain-relieved so nothing tugs the mount
- [ ] Mac mini reachable on the local network, server and web app running
- [ ] Run the calibration wizard (docs/CALIBRATION.md)
