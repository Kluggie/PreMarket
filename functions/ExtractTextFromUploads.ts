import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import pdfParse from 'npm:pdf-parse@1.1.1';
import mammoth from 'npm:mammoth@1.8.0';

Deno.serve(async (req) => {
  const correlationId = `upload_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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

    const { files, maxTotalBytes = 15000000, maxTotalChars = 120000 } = await req.json();
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return Response.json({
        ok: false,
        error: 'No files provided',
        message: 'Please upload at least one file',
        correlationId
      }, { status: 400 });
    }

    const extracted = [];
    const errors = [];
    let totalBytes = 0;
    let totalChars = 0;

    for (const fileRef of files) {
      const { fileUrl, filename, mimeType, sizeBytes } = fileRef;
      
      console.log(`[ExtractTextFromUploads] Processing: ${filename}, type: ${mimeType}, size: ${sizeBytes}, correlationId: ${correlationId}`);
      
      // Check size limit
      if (sizeBytes && sizeBytes > maxTotalBytes) {
        errors.push({
          filename,
          error: 'File too large',
          message: `File exceeds ${Math.round(maxTotalBytes / 1000000)}MB limit`,
          sizeBytes
        });
        continue;
      }
      
      totalBytes += sizeBytes || 0;
      
      try {
        // Fetch file content
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          errors.push({
            filename,
            error: 'Fetch failed',
            message: `HTTP ${fileResponse.status}: ${fileResponse.statusText}`,
            mimeType
          });
          continue;
        }
        
        let text = '';
        const warnings = [];
        
        // Extract based on type
        if (mimeType === 'text/plain' || filename.endsWith('.txt') || filename.endsWith('.md')) {
          text = await fileResponse.text();
          
        } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
          try {
            const arrayBuffer = await fileResponse.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            const pdfData = await pdfParse(buffer);
            text = pdfData.text || '';
            
            if (!text.trim()) {
              warnings.push('PDF appears empty or may contain only images');
            }
          } catch (pdfError) {
            errors.push({
              filename,
              error: 'PDF extraction failed',
              message: 'Could not extract text from PDF. It may be scanned/image-only or corrupted.',
              mimeType,
              details: pdfError.message
            });
            continue;
          }
          
        } else if (
          mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
          filename.endsWith('.docx')
        ) {
          try {
            const arrayBuffer = await fileResponse.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            const result = await mammoth.extractRawText({ buffer });
            text = result.value || '';
            
            if (result.messages && result.messages.length > 0) {
              warnings.push(`DOCX extraction warnings: ${result.messages.length} issues`);
            }
            
            if (!text.trim()) {
              warnings.push('DOCX appears empty');
            }
          } catch (docxError) {
            errors.push({
              filename,
              error: 'DOCX extraction failed',
              message: 'Could not extract text from DOCX. File may be corrupted.',
              mimeType,
              details: docxError.message
            });
            continue;
          }
          
        } else {
          errors.push({
            filename,
            error: 'Unsupported file type',
            message: `File type ${mimeType} is not supported. Use .txt, .md, .pdf, or .docx`,
            mimeType
          });
          continue;
        }
        
        // Check char limit
        if (totalChars + text.length > maxTotalChars) {
          const remaining = maxTotalChars - totalChars;
          text = text.substring(0, remaining);
          warnings.push(`Text truncated to ${maxTotalChars} chars total limit`);
        }
        
        totalChars += text.length;
        
        extracted.push({
          filename,
          mimeType,
          sizeBytes,
          chars: text.length,
          text,
          warnings
        });
        
      } catch (error) {
        console.error(`[ExtractTextFromUploads] Error processing ${filename}:`, error.message);
        errors.push({
          filename,
          error: 'Processing failed',
          message: error.message,
          mimeType
        });
      }
    }
    
    // Build combined text
    const combinedText = extracted
      .map(e => `--- ${e.filename} ---\n${e.text}`)
      .join('\n\n');
    
    // If all files failed, return error
    if (extracted.length === 0 && errors.length > 0) {
      return Response.json({
        ok: false,
        error: 'All files failed to extract',
        message: `Failed to extract text from ${errors.length} file(s). See details below.`,
        errors,
        correlationId
      }, { status: 400 });
    }
    
    return Response.json({
      ok: true,
      extracted,
      combinedText,
      errors,
      totalBytes,
      totalChars,
      correlationId
    });

  } catch (error) {
    console.error('[ExtractTextFromUploads] Unexpected error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: error.message,
      message: 'Internal error during file extraction',
      correlationId
    }, { status: 500 });
  }
});