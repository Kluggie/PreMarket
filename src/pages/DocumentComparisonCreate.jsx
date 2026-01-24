import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  ArrowLeft, ArrowRight, FileText, Upload, Type, Save, Sparkles, 
  AlertTriangle, Highlighter, X, Loader2, Link as LinkIcon, Download
} from 'lucide-react';

export default function DocumentComparisonCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(1);
  const [comparisonId, setComparisonId] = useState(null);
  
  const [title, setTitle] = useState('');
  const [partyALabel, setPartyALabel] = useState('Document A');
  const [partyBLabel, setPartyBLabel] = useState('Document B');
  
  const [docASource, setDocASource] = useState('typed');
  const [docBSource, setDocBSource] = useState('typed');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docASpans, setDocASpans] = useState([]);
  const [docBSpans, setDocBSpans] = useState([]);
  const [docAUrl, setDocAUrl] = useState('');
  const [docBUrl, setDocBUrl] = useState('');
  const [extractingUrls, setExtractingUrls] = useState(false);
  const [extractionError, setExtractionError] = useState(null);
  
  const [jsonImportA, setJsonImportA] = useState('');
  const [jsonImportB, setJsonImportB] = useState('');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get('draft');
    if (draftId) {
      setComparisonId(draftId);
      loadDraft(draftId);
    }
  }, [user]);

  const loadDraft = async (id) => {
    try {
      const comparisons = await base44.entities.DocumentComparison.filter({ id });
      const comparison = comparisons[0];
      if (!comparison) return;
      
      setTitle(comparison.title || '');
      setPartyALabel(comparison.party_a_label || 'Document A');
      setPartyBLabel(comparison.party_b_label || 'Document B');
      setDocAText(comparison.doc_a_plaintext || '');
      setDocBText(comparison.doc_b_plaintext || '');
      setDocASpans(comparison.doc_a_spans_json || []);
      setDocBSpans(comparison.doc_b_spans_json || []);
      setDocASource(comparison.doc_a_source || 'typed');
      setDocBSource(comparison.doc_b_source || 'typed');
      
      const resumeStep = comparison.draft_step || 1;
      setTimeout(() => setStep(resumeStep), 50);
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
  };

  const saveDraft = async (stepToSave) => {
    if (!user) return null;
    
    const data = {
      title: title || 'Untitled Comparison',
      created_by_user_id: user.id,
      party_a_label: partyALabel,
      party_b_label: partyBLabel,
      doc_a_plaintext: docAText,
      doc_b_plaintext: docBText,
      doc_a_spans_json: docASpans,
      doc_b_spans_json: docBSpans,
      doc_a_source: docASource,
      doc_b_source: docBSource,
      status: 'draft',
      draft_step: stepToSave,
      draft_updated_at: new Date().toISOString()
    };
    
    if (comparisonId) {
      await base44.entities.DocumentComparison.update(comparisonId, data);
      return comparisonId;
    } else {
      const comparison = await base44.entities.DocumentComparison.create(data);
      setComparisonId(comparison.id);
      return comparison.id;
    }
  };

  const handleFileUpload = (doc, file) => {
    if (!file) return;
    
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        if (doc === 'a') {
          setDocAText(text);
        } else {
          setDocBText(text);
        }
      };
      reader.onerror = () => alert('Failed to read file');
      reader.readAsText(file);
      return;
    }
    
    if (fileName.endsWith('.pdf')) {
      alert('PDF files are not supported yet. Please use .txt or .md files, or paste text directly.');
      return;
    }
    
    alert('Only .txt and .md files are supported. For other formats, please paste text directly.');
  };

  const handleExtractFromUrls = async () => {
    if (!docAUrl && !docBUrl) {
      alert('Please enter at least one URL');
      return;
    }
    
    setExtractingUrls(true);
    setExtractionError(null);
    
    try {
      const result = await base44.functions.invoke('ExtractFromUrls', {
        urlA: docAUrl || null,
        urlB: docBUrl || null
      });
      
      if (!result.data.ok) {
        const sources = result.data.sources || [];
        const failedSources = sources.filter(s => s.status === 'failed');
        
        if (failedSources.length > 0) {
          const errorMessages = failedSources.map(s => 
            `${s.url}:\n${s.message}`
          ).join('\n\n');
          
          setExtractionError({
            message: errorMessages,
            correlationId: result.data.correlationId
          });
        } else {
          setExtractionError({
            message: result.data.error || 'Failed to extract text from URLs',
            correlationId: result.data.correlationId
          });
        }
        
        // Still populate any successful extractions
        if (result.data.textA) setDocAText(result.data.textA);
        if (result.data.textB) setDocBText(result.data.textB);
        
        setExtractingUrls(false);
        return;
      }
      
      if (result.data.textA) setDocAText(result.data.textA);
      if (result.data.textB) setDocBText(result.data.textB);
      
      // Auto-advance to step 2 if extraction succeeded
      if (result.data.textA || result.data.textB) {
        await saveDraft(2);
        setStep(2);
      }
    } catch (error) {
      setExtractionError({
        message: error.response?.data?.message || error.message,
        correlationId: error.response?.data?.correlationId || 'unknown'
      });
    } finally {
      setExtractingUrls(false);
    }
  };

  const handleTextSelection = (doc) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    
    const selectedText = selection.toString();
    if (!selectedText) return null;
    
    const range = selection.getRangeAt(0);
    const container = doc === 'a' 
      ? document.getElementById('preview-a')
      : document.getElementById('preview-b');
    
    if (!container || !container.contains(range.commonAncestorContainer)) return null;
    
    const fullText = doc === 'a' ? docAText : docBText;
    const start = fullText.indexOf(selectedText);
    
    if (start === -1) return null;
    
    return {
      start,
      end: start + selectedText.length,
      text: selectedText
    };
  };

  const addHighlight = (doc, level) => {
    const selection = handleTextSelection(doc);
    if (!selection) {
      alert('Please select text to highlight');
      return;
    }
    
    const newSpan = {
      start: selection.start,
      end: selection.end,
      level
    };
    
    if (doc === 'a') {
      setDocASpans([...docASpans, newSpan].sort((a, b) => a.start - b.start));
    } else {
      setDocBSpans([...docBSpans, newSpan].sort((a, b) => a.start - b.start));
    }
    
    window.getSelection().removeAllRanges();
  };

  const removeHighlight = (doc, index) => {
    if (doc === 'a') {
      setDocASpans(docASpans.filter((_, i) => i !== index));
    } else {
      setDocBSpans(docBSpans.filter((_, i) => i !== index));
    }
  };

  const exportHighlights = (doc) => {
    const spans = doc === 'a' ? docASpans : docBSpans;
    const json = JSON.stringify(spans, null, 2);
    navigator.clipboard.writeText(json);
    alert('Highlights copied to clipboard as JSON');
  };

  const importHighlights = (doc, jsonStr) => {
    try {
      const spans = JSON.parse(jsonStr);
      if (!Array.isArray(spans)) throw new Error('Invalid format - must be array');
      
      if (doc === 'a') {
        setDocASpans(spans);
      } else {
        setDocBSpans(spans);
      }
      
      alert('Highlights imported successfully');
    } catch (error) {
      alert('Invalid JSON format: ' + error.message);
    }
  };

  const renderHighlightedText = (text, spans, docId) => {
    if (!text) return null;
    
    if (spans.length === 0) {
      return <div id={docId} className="whitespace-pre-wrap font-mono text-sm select-text">{text}</div>;
    }
    
    const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
    const parts = [];
    let lastIndex = 0;
    
    sortedSpans.forEach((span) => {
      if (span.start > lastIndex) {
        parts.push({ text: text.substring(lastIndex, span.start), highlight: null });
      }
      parts.push({ 
        text: text.substring(span.start, span.end), 
        highlight: span.level 
      });
      lastIndex = span.end;
    });
    
    if (lastIndex < text.length) {
      parts.push({ text: text.substring(lastIndex), highlight: null });
    }
    
    return (
      <div id={docId} className="whitespace-pre-wrap font-mono text-sm select-text">
        {parts.map((part, idx) => (
          <span 
            key={idx}
            className={
              part.highlight === 'confidential' 
                ? 'bg-red-200 text-red-900 px-0.5 rounded'
                : part.highlight === 'partial'
                ? 'bg-yellow-200 text-yellow-900 px-0.5 rounded'
                : ''
            }
          >
            {part.text}
          </span>
        ))}
      </div>
    );
  };

  const progress = (step / 4) * 100;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link to={createPageUrl('Dashboard')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
              <p className="text-slate-500 mt-1">Compare two documents with confidentiality controls</p>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Step {step} of 4</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Source Selection */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardHeader>
                  <CardTitle>Step 1: Source Selection</CardTitle>
                  <CardDescription>Set title and choose how you'll provide each document</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Comparison Title</Label>
                    <Input 
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., LinkedIn Profile vs Job Posting"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Document A Label</Label>
                      <Input 
                        value={partyALabel}
                        onChange={(e) => setPartyALabel(e.target.value)}
                        placeholder="e.g., Profile"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Document B Label</Label>
                      <Input 
                        value={partyBLabel}
                        onChange={(e) => setPartyBLabel(e.target.value)}
                        placeholder="e.g., Job Posting"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3 p-4 border border-slate-200 rounded-xl">
                      <Label className="font-semibold">{partyALabel} Source</Label>
                      <RadioGroup value={docASource} onValueChange={setDocASource}>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="typed" id="a-typed" />
                          <Label htmlFor="a-typed" className="font-normal cursor-pointer flex items-center gap-2">
                            <Type className="w-4 h-4" />
                            Paste / Type
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="uploaded" id="a-uploaded" />
                          <Label htmlFor="a-uploaded" className="font-normal cursor-pointer flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Upload File
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="url" id="a-url" />
                          <Label htmlFor="a-url" className="font-normal cursor-pointer flex items-center gap-2">
                            <LinkIcon className="w-4 h-4" />
                            Extract from URL
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="space-y-3 p-4 border border-slate-200 rounded-xl">
                      <Label className="font-semibold">{partyBLabel} Source</Label>
                      <RadioGroup value={docBSource} onValueChange={setDocBSource}>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="typed" id="b-typed" />
                          <Label htmlFor="b-typed" className="font-normal cursor-pointer flex items-center gap-2">
                            <Type className="w-4 h-4" />
                            Paste / Type
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="uploaded" id="b-uploaded" />
                          <Label htmlFor="b-uploaded" className="font-normal cursor-pointer flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Upload File
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="url" id="b-url" />
                          <Label htmlFor="b-url" className="font-normal cursor-pointer flex items-center gap-2">
                            <LinkIcon className="w-4 h-4" />
                            Extract from URL
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={async () => {
                      await saveDraft(2);
                      setStep(2);
                    }} className="bg-blue-600 hover:bg-blue-700">
                      Continue to Input
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Content Input */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              {/* URL Extraction Section (if either source is URL) */}
              {(docASource === 'url' || docBSource === 'url') && (
                <Card className="border-2 border-purple-200 bg-purple-50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-900">
                      <LinkIcon className="w-5 h-5" />
                      Extract from URLs
                    </CardTitle>
                    <CardDescription>Enter URLs to automatically extract text content</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {docASource === 'url' && (
                      <div className="space-y-2">
                        <Label>{partyALabel} URL</Label>
                        <Input 
                          placeholder="https://www.linkedin.com/in/..."
                          value={docAUrl}
                          onChange={(e) => setDocAUrl(e.target.value)}
                        />
                      </div>
                    )}
                    {docBSource === 'url' && (
                      <div className="space-y-2">
                        <Label>{partyBLabel} URL</Label>
                        <Input 
                          placeholder="https://..."
                          value={docBUrl}
                          onChange={(e) => setDocBUrl(e.target.value)}
                        />
                      </div>
                    )}
                    
                    {extractionError && (
                      <Alert className="border-red-200 bg-red-50">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <AlertDescription className="text-red-800">
                          <div className="font-semibold mb-2">Extraction Failed</div>
                          <div className="text-sm whitespace-pre-wrap mb-2">{extractionError.message}</div>
                          <div className="text-xs text-red-600">Correlation ID: {extractionError.correlationId}</div>
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    <Button 
                      onClick={handleExtractFromUrls}
                      disabled={extractingUrls || (docASource === 'url' && !docAUrl && docBSource === 'url' && !docBUrl)}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                    >
                      {extractingUrls ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Extracting...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Extract Text
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Document A Input */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    {partyALabel}
                  </CardTitle>
                  <CardDescription>
                    {docASource === 'typed' && 'Paste or type document content'}
                    {docASource === 'uploaded' && 'Upload a .txt or .md file'}
                    {docASource === 'url' && 'Extract text from URL above, then review and edit if needed'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {docASource === 'uploaded' && (
                    <div className="space-y-2">
                      <Label>Upload File (.txt, .md)</Label>
                      <Input 
                        type="file"
                        accept=".txt,.md"
                        onChange={(e) => handleFileUpload('a', e.target.files[0])}
                      />
                      <p className="text-xs text-slate-500">
                        For PDF files, please copy and paste the text content.
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label>Document Content</Label>
                    <Textarea 
                      value={docAText}
                      onChange={(e) => setDocAText(e.target.value)}
                      placeholder="Enter or paste document text..."
                      className="min-h-[300px] font-mono text-sm"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Document B Input */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    {partyBLabel}
                  </CardTitle>
                  <CardDescription>
                    {docBSource === 'typed' && 'Paste or type document content'}
                    {docBSource === 'uploaded' && 'Upload a .txt or .md file'}
                    {docBSource === 'url' && 'Extract text from URL above, then review and edit if needed'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {docBSource === 'uploaded' && (
                    <div className="space-y-2">
                      <Label>Upload File (.txt, .md)</Label>
                      <Input 
                        type="file"
                        accept=".txt,.md"
                        onChange={(e) => handleFileUpload('b', e.target.files[0])}
                      />
                      <p className="text-xs text-slate-500">
                        For PDF files, please copy and paste the text content.
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label>Document Content</Label>
                    <Textarea 
                      value={docBText}
                      onChange={(e) => setDocBText(e.target.value)}
                      placeholder="Enter or paste document text..."
                      className="min-h-[300px] font-mono text-sm"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={async () => {
                  await saveDraft(1);
                  setStep(1);
                }}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => saveDraft(2)}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Draft
                  </Button>
                  <Button 
                    onClick={async () => {
                      await saveDraft(3);
                      setStep(3);
                    }}
                    disabled={!docAText || !docBText}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Continue to Highlighting
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Highlighting */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <Alert className="bg-blue-50 border-blue-200">
                <Highlighter className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  <strong>How to highlight:</strong> Select text in the preview below, then click "Mark Confidential" or "Mark Partial" buttons.
                  Confidential content will be excluded from the AI report. Partial content will only be summarized at a high level.
                </AlertDescription>
              </Alert>

              {/* Document A Highlighting */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      {partyALabel}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => addHighlight('a', 'confidential')}
                      >
                        <span className="w-3 h-3 bg-red-500 rounded mr-2"></span>
                        Mark Confidential
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => addHighlight('a', 'partial')}
                      >
                        <span className="w-3 h-3 bg-yellow-500 rounded mr-2"></span>
                        Mark Partial
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 border border-slate-200 rounded-xl bg-white max-h-96 overflow-auto">
                    {renderHighlightedText(docAText, docASpans, 'preview-a')}
                  </div>
                  
                  {docASpans.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Highlights ({docASpans.length})</Label>
                        <Button variant="outline" size="sm" onClick={() => exportHighlights('a')}>
                          <Download className="w-4 h-4 mr-2" />
                          Export JSON
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {docASpans.map((span, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className={`w-3 h-3 rounded flex-shrink-0 ${span.level === 'confidential' ? 'bg-red-500' : 'bg-yellow-500'}`}></span>
                              <span className="text-slate-600 truncate">
                                {docAText.substring(span.start, Math.min(span.end, span.start + 50))}
                                {span.end - span.start > 50 ? '...' : ''}
                              </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => removeHighlight('a', idx)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Import Highlights JSON (Optional)</Label>
                    <div className="flex gap-2">
                      <Textarea 
                        value={jsonImportA}
                        onChange={(e) => setJsonImportA(e.target.value)}
                        placeholder='[{"start":0,"end":10,"level":"confidential"}]'
                        className="text-xs font-mono"
                        rows={2}
                      />
                      <Button 
                        onClick={() => importHighlights('a', jsonImportA)}
                        disabled={!jsonImportA}
                        variant="outline"
                        size="sm"
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Document B Highlighting */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-600" />
                      {partyBLabel}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => addHighlight('b', 'confidential')}
                      >
                        <span className="w-3 h-3 bg-red-500 rounded mr-2"></span>
                        Mark Confidential
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => addHighlight('b', 'partial')}
                      >
                        <span className="w-3 h-3 bg-yellow-500 rounded mr-2"></span>
                        Mark Partial
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 border border-slate-200 rounded-xl bg-white max-h-96 overflow-auto">
                    {renderHighlightedText(docBText, docBSpans, 'preview-b')}
                  </div>
                  
                  {docBSpans.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Highlights ({docBSpans.length})</Label>
                        <Button variant="outline" size="sm" onClick={() => exportHighlights('b')}>
                          <Download className="w-4 h-4 mr-2" />
                          Export JSON
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {docBSpans.map((span, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className={`w-3 h-3 rounded flex-shrink-0 ${span.level === 'confidential' ? 'bg-red-500' : 'bg-yellow-500'}`}></span>
                              <span className="text-slate-600 truncate">
                                {docBText.substring(span.start, Math.min(span.end, span.start + 50))}
                                {span.end - span.start > 50 ? '...' : ''}
                              </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => removeHighlight('b', idx)}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Import Highlights JSON (Optional)</Label>
                    <div className="flex gap-2">
                      <Textarea 
                        value={jsonImportB}
                        onChange={(e) => setJsonImportB(e.target.value)}
                        placeholder='[{"start":0,"end":10,"level":"confidential"}]'
                        className="text-xs font-mono"
                        rows={2}
                      />
                      <Button 
                        onClick={() => importHighlights('b', jsonImportB)}
                        disabled={!jsonImportB}
                        variant="outline"
                        size="sm"
                      >
                        Import
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={async () => {
                  await saveDraft(2);
                  setStep(2);
                }}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Input
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => saveDraft(3)}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Draft
                  </Button>
                  <Button 
                    onClick={async () => {
                      await saveDraft(4);
                      setStep(4);
                    }}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Continue to Evaluation
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: Evaluation */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card>
                <CardHeader>
                  <CardTitle>Step 4: Review & Evaluate</CardTitle>
                  <CardDescription>Review your comparison before running AI evaluation</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="font-medium">{title || 'Untitled Comparison'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{partyALabel} Length</span>
                      <span className="font-medium">{docAText.length} characters</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">{partyBLabel} Length</span>
                      <span className="font-medium">{docBText.length} characters</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 border border-red-200 bg-red-50 rounded-xl">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-red-700">
                          {docASpans.filter(s => s.level === 'confidential').length + docBSpans.filter(s => s.level === 'confidential').length}
                        </p>
                        <p className="text-sm text-red-600 mt-1">Confidential Spans</p>
                      </div>
                    </div>
                    <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-xl">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-yellow-700">
                          {docASpans.filter(s => s.level === 'partial').length + docBSpans.filter(s => s.level === 'partial').length}
                        </p>
                        <p className="text-sm text-yellow-600 mt-1">Partial Spans</p>
                      </div>
                    </div>
                  </div>

                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Confidentiality Guarantee:</strong> Confidential content will never be quoted in the AI report. 
                      Partial content will only be referenced at a high level. The AI reads them for analysis but provides redacted insights only.
                    </AlertDescription>
                  </Alert>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={async () => {
                      await saveDraft(3);
                      setStep(3);
                    }}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Highlighting
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => saveDraft(4)}>
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                      <Button 
                        onClick={async () => {
                          try {
                            const id = comparisonId || await saveDraft(4);
                            const result = await base44.functions.invoke('EvaluateDocumentComparison', {
                              comparison_id: id
                            });
                            
                            if (!result.data.ok) {
                              const errorMsg = result.data.message || result.data.error || 'Evaluation failed';
                              const correlationId = result.data.correlationId || 'unknown';
                              alert(`Evaluation failed:\n\n${errorMsg}\n\nCorrelation ID: ${correlationId}`);
                              return;
                            }
                            
                            navigate(createPageUrl(`DocumentComparisonDetail?id=${id}`));
                          } catch (error) {
                            const errorMsg = error.response?.data?.message || error.message;
                            const correlationId = error.response?.data?.correlationId || 'unknown';
                            alert(`Evaluation failed:\n\n${errorMsg}\n\nCorrelation ID: ${correlationId}`);
                          }
                        }}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Run Evaluation
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}