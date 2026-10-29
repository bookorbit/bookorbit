# Reading companion artwork

`build_buddy_sprites.py` holds the pixel masters of every reading companion: the cat, dog, rabbit, owl, penguin, robot, vampire, dragon, ghost, mimic, mummy, witch, skeleton, candle and alien. It uses only the Python standard library. Run from the repository root:

```sh
python3 koreader-plugin/tools/build_buddy_sprites.py
python3 koreader-plugin/tools/build_buddy_sprites.py --check
luajit koreader-plugin/spec/bookorbit_board_buddies_test.lua
```

It writes one module per companion to `bookorbit.koplugin/bookorbit_pets/`, which ships with the plugin; a tile loads only the companion it shows. Do not edit those modules directly.

Each companion has six poses on a fixed 64 x 64 canvas: `read`, `sleep`, `party`, `ribbon`, `yawn` and `wait`. Coordinates are zero-based. Parts are shapes painted back to front: each is lit from the top left in four tones of its colour ramp and outlined in the ramp's darkest colour, with an inner line where it overlaps an earlier part. Faces, stripes and other details go on the final grid. Every colour carries the grey a black-and-white screen shows instead (KOReader's own luma, unless a colour overrides it), and each module's palette maps a character to both. Keep silhouettes recognizable in grey and avoid one-pixel colour details: colour e-ink resolves colour at half the resolution of its black and white.

Review every pose in colour and in grey after editing, and inspect the actual KOReader widgets at small, medium and large sizes. The renderer paints solid rectangles at whole or half steps of scale (cells at 1.5x alternate one and two pixels) without bitmap interpolation. Gallery snapshot and layout cache keys must distinguish `props.animal`.
