//! `kubuno-drive` — module de gestion de fichiers.
//!
//! Deux faces :
//! - **client** (toujours compilé, dépendances légères) : `FilesClient` + gestion
//!   des noms, utilisé par les modules éditeurs pour déléguer le stockage à `files`.
//! - **server** (feature `server`, activée par défaut) : le module HTTP complet
//!   (handlers, services, accès `kubuno-storage`/disque, etc.).
//!
//! Ainsi `kubuno-storage` n'est une dépendance que du **serveur** `files` : les
//! modules éditeurs dépendent de `kubuno-drive` (face client) sans rien tirer du
//! backend de stockage.

pub mod client;

#[cfg(feature = "server")]
pub mod config;
#[cfg(feature = "server")]
pub mod errors;
#[cfg(feature = "server")]
pub mod events;
#[cfg(feature = "server")]
pub mod handlers;
#[cfg(feature = "server")]
pub mod middleware;
#[cfg(feature = "server")]
pub mod models;
#[cfg(feature = "server")]
#[cfg(feature = "server")]
pub mod router;
#[cfg(feature = "server")]
pub mod services;
#[cfg(feature = "server")]
pub mod state;
