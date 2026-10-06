fn main() {
    // libgit2 (vendored) references advapi32: security tokens (OpenProcessToken,
    // GetNamedSecurityInfoW) and the legacy Crypt* API (CryptGenRandom). Without
    // `git2`'s transport features, `libgit2-sys` does not emit this link.
    println!("cargo:rustc-link-lib=dylib=advapi32");
    println!("cargo:rerun-if-changed=build.rs");
}
