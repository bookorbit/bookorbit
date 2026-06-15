UPDATE reading_sessions rs SET book_id = bf.book_id FROM book_files bf WHERE bf.id = rs.book_file_id AND rs.book_id IS NULL;--> statement-breakpoint
UPDATE reading_sessions SET source = 'koreader' WHERE session_id LIKE 'kor:%' AND source IS DISTINCT FROM 'koreader';
