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
];
