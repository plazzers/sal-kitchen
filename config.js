// =====================================================================
//  Sal's Kitchen — settings you can change.
//  Edit the text between the quotes. Keep the quotes and commas.
// =====================================================================

export const APP_NAME = "Sal's Kitchen — Chef Sal Romano";

// Links shown in Settings → About
export const YOUTUBE_URL = "https://www.youtube.com/@ChefSalRomano";
export const STORE_URL = "https://payhip.com/SalRomano";
export const SUPPORT_EMAIL = "salromanochef@outlook.com";

// "Get it" link on the locked Sal's Italian Kitchen card
export const ITALIAN_STORE_URL = "https://payhip.com/b/Lv425?utm_source=app&utm_medium=locked-pack&utm_campaign=italian";

// Access codes. Never put the real codes here — only their "hash".
// This list is only a quick first check ("is this any valid code?"). What really opens
// the recipes is the code itself, which unlocks the encrypted packs in packs/ (see README).
// So every code needs BOTH: its hash here, and a place in a pack (tools/build_packs.py).
// Make a hash with tools/make-code-hash.html (or build_packs.py --print-hashes), then paste
// it as a new line inside the square brackets below (one line per code, each ending with a comma).
// Codes are not case-sensitive (sal-abcd-1234 works the same as SAL-ABCD-1234).
export const ACCESS_CODE_HASHES = [
  "7bbb8504a61319e0f0f17663d81ce0930b2efe4686525369bdd09c180aa261c4", // code #1
  "2e9eb1e1c3d6daa24592b382f3a45ba7573da183f85cbcd4e6b40823ca1f4bf5", // code #2
  "2ace3e3f01184fe635af0cd0dc7d1d9078dd8ca033c2b12d299084962e17c3d4", // code #3
  "a2b2f289efdc97161b4eefe94009b2368faf5501468729aa8c874921a7612c05", // code #4
  "728e339d4fa628ad2ee0494c66fe12baa793f37c09b5b10cff557cc3e8d53e73", // code #5
  "7f94b21c40bb3b8333460212e968ebb8a62c9c0e7da872c0220f4b3ac0244519", // code #6
  "7069a911df311d761f52774d2942708aa3a236ffc12a6a8241eebab838bdc558", // code #7
  "ab2a879a0bf462e94ca8c2f70ee76d34a8ed6bac1c2dc4eb963b867240467fa1", // code #8
  "a3ff02b7488c2981f0effc73bc83cb8afd471a958854a114813318591ac2e938", // code #9
  "f923aeca79d1682de45c756461ae4ca0701a92a66f7c86a03aa3a78682d32ced", // code #10
  "28a118faaffbcab84575e85a420572ed939efb636a1599431cec109ccd537d3e", // italian #1
  "b8fd6395a64537d3ebb414c91288f816e16435f0806cd8087f2dceea805e2035", // italian #2
  "faf69d6fb5aa19bad54a3836387285bce09303b8ca7c5cf0349d98f5fdabbc2d", // italian #3
  "b23e5fb44528ff0a18b1fed27faa58edd065542589e8b4a8c894cea983634074", // italian #4
  "84604e8e2df02f3ad4c56d929ccbe52b3669007c782ed273b5666a2e9b700f35", // italian #5
  "1d57d95bbf5af96829eb3b7ed555e17f06b177be791de73d6584db7186758260", // italian #6
  "e1f32f2eb2966fe2a49e73c78bd77f5bf7b3b27c21caa8d7ee08216e1188fa86", // italian #7
  "fddbbe421db80825e3953a96c275c349149e2f864d67823d47f112827458724d", // italian #8
  "425d3f959eff5bef469136d31d46f67698cbbe50eab58cbf021ad4a0e223b25f", // italian #9
  "12dd2713ca73bd223cdea15d905fbd06796c64f2a9663efee53cbd307ffccf51", // italian #10
  "d9584011b9155460e5639589256adfdf589581a5059c21e3f4ecf223ca126588", // bundle (copycat + italian) #1
  "4c6c147dc1778a85229c4e71bda0edb21e239691f5474f8d3b379ae819edc261", // bundle (copycat + italian) #2
  "c2ee392e3a52cbd1edced780b2d75cc76355bd23dfcb7d500bd20509cdbe1c0e", // bundle (copycat + italian) #3
  "3b7de60e3187bad8dbc38b93e0b83af3800c62664af5ea3a7ddd67be92acf21a", // bundle (copycat + italian) #4
  "16d797fe71a9b9cead547ad063586a0b77f3ab2ec7832506d5682777a8ce6977", // bundle (copycat + italian) #5
];
