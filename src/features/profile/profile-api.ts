import { supabase } from '../../lib/supabase'
import type { ProfileDraft } from './profile-types'

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
export async function loadAccountProfile(userId: string) {
  const { data, error } = await client().from('profiles').select('*').eq('id', userId).single()
  if (error) throw new Error('Unable to load your profile. Check your connection and try again.')
  if (!data.username) throw new Error('Profile setup is not available yet. The account profile migration needs to be applied.')
  return data
}
export async function avatarUrl(path: string | null) {
  if (!path) return null
  try {
    const { data, error } = await client().storage.from('profile-avatars').createSignedUrl(path, 3600)
    return error ? null : data.signedUrl
  } catch { return null }
}
export async function saveAccountProfile(draft: ProfileDraft, updatedAt: string) {
  const { data, error } = await client().rpc('save_account_profile', {
    p_expected_updated_at: updatedAt, p_name: draft.name.trim(), p_username: draft.username.trim().toLowerCase(),
    p_badge_display: draft.badge_display, p_avatar_preset: draft.avatar_preset,
    p_avatar_path: draft.avatar_path, p_affiliation: draft.affiliation.trim(), p_bio: draft.bio.trim(),
  })
  if (error) throw new Error(error.message)
  return data
}

export async function prepareAvatar(file: File): Promise<Blob> {
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.')
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)
  const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  const isWebp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (!isPng && !isJpeg && !isWebp) throw new Error('Choose a JPEG, PNG or WebP image. Export HEIC photos as JPEG first.')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This image could not be opened. Try another image.') }
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 32000000) {
      throw new Error('Choose an image up to 8,192 pixels per side and 32 megapixels.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare the image.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .88))
    if (!blob || blob.type !== 'image/webp' || blob.size > 1048576) throw new Error('Unable to prepare this photo. Try a smaller image.')
    return blob
  } finally { bitmap.close() }
}
export async function uploadAvatar(userId: string, blob: Blob) {
  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await client().storage.from('profile-avatars').upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (error) throw new Error('Photo upload failed. Check your connection, or use “Clean up unused photos” if your photo storage is full.')
  return path
}
// Database policies prevent deletion of the saved image, including concurrent saves.
export async function removeUnusedAvatar(path: string) {
  await client().storage.from('profile-avatars').remove([path])
}
export async function cleanupUnusedAvatars(userId: string) {
  const profile = await loadAccountProfile(userId)
  const { data, error } = await client().storage.from('profile-avatars').list(userId, { limit: 100 })
  if (error) throw new Error('Unable to load unused photos. Try again.')
  const paths = data.map(item => `${userId}/${item.name}`).filter(path => path !== profile.avatar_path)
  if (paths.length) {
    const { error: removeError } = await client().storage.from('profile-avatars').remove(paths)
    if (removeError) throw new Error('Unable to clean up unused photos. Try again.')
  }
}
