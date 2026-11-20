import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { isImageCropFailure, requestImageCrop } from '@/lib/imageCropSession'
import { supabase } from '@/lib/supabase'

export type AvatarUploadResult =
  | { ok: true; publicUrl: string }
  | { ok: false; error: string; cancelled?: boolean }

const AVATAR_MAX_BYTES = 2 * 1024 * 1024

type LibraryPick =
  | { ok: true; uri: string; base64: string; width: number; height: number }
  | { ok: false; error: string; cancelled?: boolean }

function libraryPickFailed(result: LibraryPick): result is Extract<LibraryPick, { ok: false }> {
  return result.ok === false
}

async function pickLibraryImage(): Promise<LibraryPick> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    return { ok: false, error: 'Photo library access is required to change your photo.' }
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.85,
    base64: true,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  })

  if (picked.canceled || !picked.assets[0]?.uri) {
    return { ok: false, error: 'Cancelled', cancelled: true }
  }

  const asset = picked.assets[0]
  const base64 =
    asset.base64 ??
    (await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }))
  if (!base64) return { ok: false, error: 'Could not read that photo.' }
  return { ok: true, uri: asset.uri, base64, width: asset.width || 0, height: asset.height || 0 }
}

async function uploadAvatarBase64(userId: string, base64: string): Promise<AvatarUploadResult> {
  const path = `${userId}/avatar.jpeg`
  const { error: upErr } = await supabase.storage.from('avatars').upload(path, decode(base64), {
    contentType: 'image/jpeg',
    upsert: true,
  })

  if (upErr) {
    return {
      ok: false,
      error:
        'Could not save that photo. Try again.',
    }
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
  const publicUrl = `${pub.publicUrl}?t=${Date.now()}`
  return { ok: true, publicUrl }
}

/**
 * Pick + upload to Storage only (no `profiles` update). Use during onboarding, then set `avatar_url` in your upsert.
 */
export async function pickAndUploadAvatarOnly(userId: string): Promise<AvatarUploadResult> {
  const picked = await pickLibraryImage()
  if (libraryPickFailed(picked)) return picked

  const cropped = await requestImageCrop({
    uri: picked.uri,
    base64: picked.base64,
    width: picked.width,
    height: picked.height,
    aspect: 1,
    shape: 'circle',
    maxEdge: 1024,
    maxBytes: AVATAR_MAX_BYTES,
  })
  if (isImageCropFailure(cropped)) {
    return cropped.cancelled
      ? { ok: false, error: 'Cancelled', cancelled: true }
      : { ok: false, error: cropped.error || 'Could not crop that photo.' }
  }
  return uploadAvatarBase64(userId, cropped.base64)
}

/**
 * Pick an image, upload to Storage bucket `avatars` at `{userId}/avatar.jpeg`,
 * then set `profiles.avatar_url`. Requires a public `avatars` bucket + RLS (see SQL).
 */
export async function pickAndUploadProfileAvatar(userId: string): Promise<AvatarUploadResult> {
  const uploaded = await pickAndUploadAvatarOnly(userId)
  if (!uploaded.ok) return uploaded

  const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: uploaded.publicUrl }).eq('id', userId)
  if (dbErr) return { ok: false, error: dbErr.message }
  return uploaded
}
