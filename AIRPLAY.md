# if NOT paired
1. GET /info CSeq: 0 Content-Type: application/x-apple-binary-plist
2. GET /pair-setup CSeq: 1 
3. GET /pair-verify CSeq: 2 

4. GET /info CSeq: 4 Content-Type: (null)


# if paired
1. GET /info CSeq: 0 Content-Type: application/x-apple-binary-plist
2. POST /fp-setup CSeq: 1 Content-Type: application/octet-stream
2. POST /fp-setup CSeq: 2 Content-Type: application/octet-stream
3. rtsp://fe80::2d:7138:2c19:201/358872973077004467 RTSP/1.0 CSeq: 3