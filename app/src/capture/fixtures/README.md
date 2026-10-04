# Cherry photo fixtures

Four real photos of coffee cherry from Wikimedia Commons, shrunk to 64 pixels wide and stored as raw RGBA bytes
(`*.rgba`, 4 bytes per pixel, row by row). They are read only by the unit tests of the cherry band heuristic
(`../cherry.ts`). They are not shipped in the app and were not used to train anything.

| File | Source | Author | Licence | What the test expects |
|---|---|---|---|---|
| `cherry_two_ripe_on_white.rgba` | [Coffee cherries on white background.png](https://commons.wikimedia.org/wiki/File:Coffee_cherries_on_white_background.png) | Filo gèn' | CC BY-SA 4.0 | Band A |
| `cherry_cut_and_beans_on_white.rgba` | [Coffea - Drup on White background.png](https://commons.wikimedia.org/wiki/File:Coffea_-_Drup_on_White_background.png) | Filo gèn' | CC BY-SA 4.0 | A band lower than A (cut fruit and pale beans are not ripe red) |
| `cherry_tree_far.rgba` | [Ripe coffee cherries.jpg](https://commons.wikimedia.org/wiki/File:Ripe_coffee_cherries.jpg) | Musimbi gerald | CC0 | No grade: no card in the photo |
| `cherry_on_branch.rgba` | [Coffee cherries of varying ripeness, on a tree in Colombia (by Brian Smith).jpg](https://commons.wikimedia.org/wiki/File:Coffee_cherries_of_varying_ripeness,_on_a_tree_in_Colombia_(by_Brian_Smith).jpg) | U.S. Fish and Wildlife Service, Northeast Region | Public domain | No grade: no card in the photo |

The two CC BY-SA 4.0 thumbnails are adaptations (resized) and stay under CC BY-SA 4.0.

Limits: the two "on white" photos are close-up studio shots of two to six fruits with the background removed, not a
handful of cherry photographed on the printed card. None of the four is from Kenya.
