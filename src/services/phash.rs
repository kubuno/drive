//! Empreinte perceptuelle d'image (dHash 64 bits) pour la recherche d'images similaires.
//! Indépendant de tout modèle ML : redimensionne en 9×8 niveaux de gris et compare les
//! pixels horizontaux adjacents → 64 bits. La similarité = distance de Hamming (faible = proche).

/// Calcule le dHash d'une image encodée (JPEG/PNG/WebP/GIF). `None` si non décodable.
/// Stocké en i64 (BIGINT Postgres) — réinterprétation binaire du u64.
pub fn dhash(bytes: &[u8]) -> Option<i64> {
    let img = image::load_from_memory(bytes).ok()?;
    // 9 colonnes × 8 lignes en niveaux de gris → 8 comparaisons par ligne = 64 bits.
    let small = image::imageops::grayscale(&img.resize_exact(9, 8, image::imageops::FilterType::Triangle));
    let mut hash: u64 = 0;
    let mut bit = 0;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left  = small.get_pixel(x, y).0[0];
            let right = small.get_pixel(x + 1, y).0[0];
            if left > right { hash |= 1u64 << bit; }
            bit += 1;
        }
    }
    Some(hash as i64)
}

/// Distance de Hamming entre deux empreintes (nombre de bits différents, 0..64).
pub fn hamming(a: i64, b: i64) -> u32 {
    ((a as u64) ^ (b as u64)).count_ones()
}
