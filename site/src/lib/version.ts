/**
 * Single source of truth pra todas as referências de versão no site.
 * Atualizado a cada release. Importado por Hero, Footer, BaseLayout,
 * DownloadCTA, FAQ — qualquer lugar que mostre versão/tamanho/checksum.
 */

export const VERSION = '0.1.8'
export const V_TAG = `v${VERSION}`
export const SIZE_MB = 83
export const SETUP_EXE = `flowtype-setup-${V_TAG}.exe`
export const PORTABLE_EXE = `flowtype-portable-${V_TAG}.exe`
// SHA-256 do setup .exe deste release (gerado via PowerShell Get-FileHash).
export const SHA256_SETUP =
  '43f7db04f9a0f1917b505692c53f7bfbffb113d5e237c60c71bf8f9562496e38'
export const SHA256_PORTABLE =
  '2bca86183af87c5c0a646a64b1e658f5b1f3be86f7a94ffebd3ff377b11c01a7'

export const DOWNLOAD_URL_EXE = `/download/${SETUP_EXE}`
export const DOWNLOAD_URL_ZIP = `/download/${PORTABLE_EXE}`
export const CHECKSUMS_URL = '/download/checksums.txt'
