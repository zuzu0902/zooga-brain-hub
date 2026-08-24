CREATE POLICY "broadcast media read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'broadcast-media');
CREATE POLICY "broadcast media insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'broadcast-media');
CREATE POLICY "broadcast media update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'broadcast-media') WITH CHECK (bucket_id = 'broadcast-media');
CREATE POLICY "broadcast media delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'broadcast-media');