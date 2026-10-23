# Reading companion artwork

`build_buddy_sprites.py` holds the dog, rabbit, owl, penguin, robot, vampire, dragon and ghost pixel masters. It uses only the Python standard library. Run from the repository root:

```sh
python3 koreader-plugin/tools/build_buddy_sprites.py
python3 koreader-plugin/tools/build_buddy_sprites.py --check
luajit koreader-plugin/spec/bookorbit_board_buddies_test.lua
```

The generated `bookorbit_board_animal_sprites.lua` ships with the plugin. Do not edit it directly. The original cat remains in `bookorbit_board_sprites.lua`.

Each character has six poses on a fixed 40 x 40 canvas: `read`, `sleep`, `party`, `ribbon`, `yawn` and `wait`. Coordinates are zero-based. Parts are painted back to front with a one-pixel outline; faces and small details are placed on the final grid. The palette matches `BoardArt.sprite`: transparent space, black `#`, dark gray `d`, mid gray `m`, light gray `l` and white `.`. Keep silhouettes recognizable at native resolution and avoid isolated gray details that disappear on e-ink.

Review every pose at 1x and an enlarged integer scale after editing. Also inspect the actual KOReader widgets at small, medium and large sizes. The renderer paints solid integer-sized rectangles without bitmap interpolation; layout dimensions come from the selected animal's canvas. Gallery snapshot and layout cache keys must distinguish `props.animal`.
