// Générateur i18n du module Files : i18n.data.json → i18n.ts
// Usage : node src/modules/files/gen_i18n.mjs  (depuis frontend/)
// Source de vérité = i18n.data.json (ns → clés). Ajoutez-y vos clés puis régénérez.
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(here, 'i18n.data.json'), 'utf8'))

const LANGS = ['en','fr','es','pt','it','de','el','ru','ar','he','hi','zh','ja']
// Ordre d'affichage des namespaces (les nouveaux en fin de liste).
const NS_ORDER = [
  'storage','common','newfolder','move','importurl','nav','tree','audio','archive',
  'recent_widget','dashboard_widget','folderpicker','opendialog','savedialog','version',
]

function nsOrderFor(obj) {
  const known = NS_ORDER.filter(n => n in obj)
  const extra = Object.keys(obj).filter(n => !NS_ORDER.includes(n))
  return [...known, ...extra]
}

let out = '// Traductions du module Files — GÉNÉRÉ depuis i18n.data.json (node src/modules/files/gen_i18n.mjs). 13 langues.\n'
out += "// Ne pas éditer à la main : modifier i18n.data.json puis régénérer.\n"
out += "import { registerModuleTranslations } from '@kubuno/sdk'\n\n"

for (const lang of LANGS) {
  const obj = data[lang]
  out += `const ${lang} = {\n`
  for (const ns of nsOrderFor(obj)) {
    out += `  ${ns}: ${JSON.stringify(obj[ns])},\n`
  }
  out += '}\n'
}

out += `\nregisterModuleTranslations('drive', { ${LANGS.join(', ')} })\n`

writeFileSync(join(here, 'i18n.ts'), out)
console.log('i18n.ts régénéré —', LANGS.length, 'langues,', nsOrderFor(data.en).length, 'namespaces')
