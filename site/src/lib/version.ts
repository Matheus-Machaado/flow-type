/**
 * Single source of truth pra todas as referências de versão no site.
 * Atualizado a cada release. Importado por Hero, Footer, BaseLayout,
 * DownloadCTA, FAQ — qualquer lugar que mostre versão/tamanho/checksum.
 */

export const VERSION = '0.1.7'
export const V_TAG = `v${VERSION}`
export const SIZE_MB = 83
export const SETUP_EXE = `flowtype-setup-${V_TAG}.exe`
export const PORTABLE_EXE = `flowtype-portable-${V_TAG}.exe`
// SHA-256 do setup .exe deste release (gerado via PowerShell Get-FileHash).
export const SHA256_SETUP =
  'f5fee0f98ca99aba0ef67f6c3f1e1c71d9a616f95b569b4e84af901a997bdc12'
export const SHA256_PORTABLE =
  '1b16560c1b964fdad1ca6ae5aa6a29b4a510921cc7ba997a2be29b49046fa935'

export const DOWNLOAD_URL_EXE = `/download/${SETUP_EXE}`
export const DOWNLOAD_URL_ZIP = `/download/${PORTABLE_EXE}`
export const CHECKSUMS_URL = '/download/checksums.txt'
