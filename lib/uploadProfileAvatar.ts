import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '@/lib/supabase'

export type AvatarUploadResult =
  | { ok: true; publicUrl: string }
  | { ok: false; error: string; cancelled?: boolean }

/**
 * Pick an image, upload to Storage bucket `avatars` at `{userId}/avatar.{ext}`,
 * then set `profiles.avatar_url`. Requires a public `avatars` bucket + RLS (see SQL).
 */
export async function pickAndUploadProfileAvatar(userId: string): Promise<AvatarUploadResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    return { ok: false, error: 'Photo library access is required to change your photo.' }
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
    base64: true,
  })

  if (picked.canceled || !picked.assets[0]) {
    return { ok: false, error: 'Cancelled', cancelled: true }
  }

  const asset = picked.assets[0]
  const uri = asset.uri
  const extGuess = uri.split('.').pop()?.toLowerCase()
  const ext = extGuess === 'png' ? 'png' : 'jpeg'
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
  const path = `${userId}/avatar.${ext}`

  let buffer: ArrayBuffer
  if (asset.base64) {
    buffer = decode(asset.base64)
  } else {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    })
    buffer = decode(b64)
  }

  const { error: upErr } = await supabase.storage.from('avatars').upload(path, buffer, {
    contentType,
    upsert: true,
  })

  if (upErr) {
    return {
      ok: false,
      error:
        upErr.message +
        ' — Create a public bucket named "avatars" and storage policies (see supabase/sql/crea_app_features.sql).',
    }
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
  const publicUrl = `${pub.publicUrl}?t=${Date.now()}`

  const { error: dbErr } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', userId)

  if (dbErr) {
    return { ok: false, error: dbErr.message }
  }

  return { ok: true, publicUrl }
}
