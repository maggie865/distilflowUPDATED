import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const FOLDER_ID = '16DKDAHGm5dkDwnv2DjITKhgPbw3aTAMe';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName') || file.name || 'packing_slip';

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');

    // Upload file to Google Drive using multipart upload
    const fileBytes = await file.arrayBuffer();
    const mimeType = file.type || 'application/octet-stream';

    const metadata = JSON.stringify({
      name: fileName,
      parents: [FOLDER_ID],
    });

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`;
    const filePart = `${delimiter}Content-Type: ${mimeType}\r\n\r\n`;
    const closeBytes = new TextEncoder().encode(closeDelim);

    const metaBytes = new TextEncoder().encode(metaPart);
    const filePartBytes = new TextEncoder().encode(filePart);

    const body = new Uint8Array(
      metaBytes.byteLength + filePartBytes.byteLength + fileBytes.byteLength + closeBytes.byteLength
    );
    body.set(metaBytes, 0);
    body.set(filePartBytes, metaBytes.byteLength);
    body.set(new Uint8Array(fileBytes), metaBytes.byteLength + filePartBytes.byteLength);
    body.set(closeBytes, metaBytes.byteLength + filePartBytes.byteLength + fileBytes.byteLength);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return Response.json({ error: `Drive upload failed: ${err}` }, { status: 500 });
    }

    const driveFile = await uploadRes.json();

    // Make the file readable by anyone with the link
    await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return Response.json({ 
      file_id: driveFile.id,
      view_url: driveFile.webViewLink,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});