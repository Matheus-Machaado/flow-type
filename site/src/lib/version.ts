/**
 * Single source of truth pra todas as referências de versão no site.
 * Atualizado a cada release. Importado por Hero, Footer, BaseLayout,
 * DownloadCTA, FAQ — qualquer lugar que mostre versão/tamanho/checksum.
 */

export const VERSION = '0.1.5'
export const V_TAG = `v${VERSION}`
export const SIZE_MB = 83
export const SETUP_EXE = `flowtype-setup-${V_TAG}.exe`
export const PORTABLE_EXE = `flowtype-portable-${V_TAG}.exe`
// SHA-256 do setup .exe deste release (gerado via PowerShell Get-FileHash).
export const SHA256_SETUP =
  '3c42357e3ffb0f0f4b080b24261d34dd43f7d753c0ccdd430287cd31f5f81cdf'
export const SHA256_PORTABLE =
  'dcb13d4d49acf1b6e619eabca8a5c7fccca6956aee1d8b486a167a1053bd5c38'

export const DOWNLOAD_URL_EXE = `/download/${SETUP_EXE}`
export const DOWNLOAD_URL_ZIP = `/download/${PORTABLE_EXE}`
export const CHECKSUMS_URL = '/download/checksums.txt'
