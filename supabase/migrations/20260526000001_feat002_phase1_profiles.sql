-- G-1: アバター URL
ALTER TABLE profiles
  ADD COLUMN avatar_url text;

-- G-2: 弁護人カスタム指示（DB CHECK 制約で 200 文字を強制）
ALTER TABLE profiles
  ADD COLUMN defense_custom_instruction text
  CHECK (defense_custom_instruction IS NULL OR char_length(defense_custom_instruction) <= 200);

-- avatars バケット（public = true: 公開 URL で直接参照可能）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 認証済みユーザーが自分の {user_id}/ 配下にのみアップロード可
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 読み取りは全員可（公開 URL で直接参照するため）
CREATE POLICY "Anyone can read avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');
