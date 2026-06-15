//! Client d'embeddings OPTIONNEL, générique (compatible OpenAI : POST {url}/embeddings).
//! Découplé de tout module (pointable vers Ollama, OpenAI, jarvis…). Fail-open :
//! toute erreur désactive le sémantique pour la requête, sans casser le plein-texte.

use crate::config::EmbeddingsSettings;

/// Le sémantique est-il activable ? (activé + URL fournie)
pub fn is_enabled(cfg: &EmbeddingsSettings) -> bool {
    cfg.enabled && cfg.provider_url.as_deref().map(|u| !u.is_empty()).unwrap_or(false)
}

/// Calcule l'embedding d'un texte. Renvoie une erreur (fail-open géré par l'appelant).
pub async fn embed(
    client: &reqwest::Client,
    cfg: &EmbeddingsSettings,
    input: &str,
) -> anyhow::Result<Vec<f32>> {
    let url = cfg
        .provider_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("embeddings.provider_url manquant"))?;
    let model = cfg.model.as_deref().unwrap_or("text-embedding-3-small");
    let endpoint = format!("{}/embeddings", url.trim_end_matches('/'));

    // Tronquer l'entrée pour rester sous les limites de contexte des modèles d'embedding.
    let input = if input.len() > 24_000 { &input[..24_000] } else { input };

    let mut req = client
        .post(&endpoint)
        .json(&serde_json::json!({ "model": model, "input": input }));
    if let Some(key) = cfg.api_key.as_deref() {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    let resp = req.send().await?.error_for_status()?;
    let v: serde_json::Value = resp.json().await?;
    let arr = v["data"]
        .get(0)
        .and_then(|d| d["embedding"].as_array())
        .ok_or_else(|| anyhow::anyhow!("réponse embeddings invalide"))?;
    let vec: Vec<f32> = arr.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect();
    if vec.is_empty() {
        anyhow::bail!("embedding vide");
    }
    Ok(vec)
}

/// Similarité cosinus. Renvoie 0 si dimensions différentes ou vecteur nul.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}
