/**
 * Single source of truth pra todas as referências de versão no site.
 * Atualizado a cada release. Importado por Hero, Footer, BaseLayout,
 * DownloadCTA, FAQ — qualquer lugar que mostre versão/tamanho/checksum.
 */

export const VERSION = '0.1.6'
export const V_TAG = `v${VERSION}`
export const SIZE_MB = 83
export const SETUP_EXE = `flowtype-setup-${V_TAG}.exe`
export const PORTABLE_EXE = `flowtype-portable-${V_TAG}.exe`
// SHA-256 do setup .exe deste release (gerado via PowerShell Get-FileHash).
export const SHA256_SETUP =
  'c239ce07769ad1d9542bf3dac750a0a89f9259ad38b75352e23fe1ffc1374efa'
export const SHA256_PORTABLE =
  '97a7a19d3b313e81ded93c4b9e0ae877cc89007a16665387525a3fe28cbcb186'

export const DOWNLOAD_URL_EXE = `/download/${SETUP_EXE}`
export const DOWNLOAD_URL_ZIP = `/download/${PORTABLE_EXE}`
export const CHECKSUMS_URL = '/download/checksums.txt'
