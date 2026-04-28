import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `file_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false, 
        error: 'Unauthorized',
        correlationId 
      }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    
    if (!file) {
      return Response.json({
        ok: false,
        error: 'No file provided',
        errorMessage: 'Please select a file to upload',
        correlationId
      }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return Response.json({
        ok: false,
        error: 'Invalid file',
        errorMessage: 'File upload is invalid or missing',
        correlationId
      }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    
    // Handle .txt and .md (should be handled client-side but support here too)
    if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      const text = await file.text();
      return Response.json({
        ok: true,
        extractedText: text,
        correlationId
      });
    }
    
    // Block PDF and DOCX with clear message
    if (fileName.endsWith('.pdf')) {
      return Response.json({
        ok: false,
        error: 'PDF extraction not supported',
        errorMessage: 'PDF extraction is not available in this environment. Please export your PDF to text (.txt) or paste the content directly.',
        correlationId
      }, { status: 400 });
    }
    
    if (fileName.endsWith('.docx')) {
      return Response.json({
        ok: false,
        error: 'DOCX extraction not supported',
        errorMessage: 'DOCX extraction is not available in this environment. Please export your document to text (.txt) or paste the content directly.',
        correlationId
      }, { status: 400 });
    }
    
    return Response.json({
      ok: false,
      error: 'Unsupported file type',
      errorMessage: 'Only .txt and .md files are supported. Please convert your file to text format.',
      correlationId
    }, { status: 400 });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('ExtractTextFromFile error:', error);
    return Response.json({
      ok: false,
      error: err.message,
      errorMessage: 'Internal error during file extraction',
      correlationId
    }, { status: 500 });
  }
});
