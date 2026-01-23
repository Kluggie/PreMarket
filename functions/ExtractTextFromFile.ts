import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized', ok: false }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    
    if (!file) {
      return Response.json({ 
        error: 'No file provided', 
        ok: false 
      }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let extractedText = '';
    let fileType = 'unknown';

    // TXT and MD files
    if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      fileType = fileName.endsWith('.txt') ? 'txt' : 'md';
      extractedText = await file.text();
    }
    // PDF files
    else if (fileName.endsWith('.pdf')) {
      fileType = 'pdf';
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Basic PDF text extraction - look for text between parentheses
      const pdfText = new TextDecoder().decode(bytes);
      const textMatches = pdfText.match(/\(([^)]+)\)/g) || [];
      extractedText = textMatches
        .map(t => t.slice(1, -1))
        .join(' ')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!extractedText || extractedText.length < 50) {
        return Response.json({
          error: 'Unable to extract text from PDF. Please use a text-based PDF or convert to .txt',
          ok: false
        }, { status: 400 });
      }
    }
    // DOCX files
    else if (fileName.endsWith('.docx')) {
      fileType = 'docx';
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Basic DOCX extraction - it's a ZIP with XML
      const text = new TextDecoder().decode(bytes);
      const xmlMatches = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      extractedText = xmlMatches
        .map(t => t.replace(/<[^>]+>/g, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!extractedText || extractedText.length < 50) {
        return Response.json({
          error: 'Unable to extract text from DOCX. Please use .txt or .md format',
          ok: false
        }, { status: 400 });
      }
    }
    else {
      return Response.json({
        error: 'Unsupported file type. Please use .txt, .md, .pdf, or .docx',
        ok: false
      }, { status: 400 });
    }

    // Cap at 50k chars
    const MAX_LENGTH = 50000;
    const truncated = extractedText.length > MAX_LENGTH;
    if (truncated) {
      extractedText = extractedText.substring(0, MAX_LENGTH);
    }

    return Response.json({
      ok: true,
      text: extractedText,
      meta: {
        type: fileType,
        truncated,
        originalLength: extractedText.length
      }
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      ok: false
    }, { status: 500 });
  }
});