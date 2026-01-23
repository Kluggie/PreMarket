import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  ArrowLeft, ArrowRight, FileText, Upload, Type, Clipboard,
  Save, Sparkles, AlertTriangle, Highlighter, Lock, Unlock, X, Check, Loader2, Link as LinkIcon
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
  const [uploadingFile, setUploadingFile] = useState(null);
  
  const [editingDoc, setEditingDoc] = useState('a');
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState(null);
  const [highlightNote, setHighlightNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState(null);
  
  const [docALocked, setDocALocked] = useState(false);
  const [docBLocked, setDocBLocked] = useState(false);
  
  const [jsonImportA, setJsonImportA] = useState('');
  const [jsonImportB, setJsonImportB] = useState('');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get('draft');
    if (draftId) {
      setComparisonId(draftId);
      loadDraft(draftId);
    }
  }, []);

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
      
      if (comparison.doc_a_spans_json?.length > 0) setDocALocked(true);
      if (comparison.doc_b_spans_json?.length > 0) setDocBLocked(true);
      
      // Resume at saved draft step
      const resumeStep = comparison.draft_step || 1;
      setStep(resumeStep);
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
  };

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const data = {
        title: title || 'Untitled Comparison',
        created_by_user_id: user?.id,
        party_a_label: partyALabel,
        party_b_label: partyBLabel,
        doc_a_plaintext: docAText,
        doc_b_plaintext: docBText,
        doc_a_spans_json: docASpans,
        doc_b_spans_json: docBSpans,
        doc_a_source: docASource,
        doc_b_source: docBSource,
        status: 'draft',
        draft_step: step,
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['documentComparisons']);
    }
  });

  const handleTextSelection = (doc) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    
    const textarea = doc === 'a' 
      ? document.getElementById('doc-a-textarea')
      : document.getElementById('doc-b-textarea');
    
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value.substring(start, end);
    
    if (text && text.length > 0) {
      setSelectedText(text);
      setSelectionRange({ start, end });
      setEditingDoc(doc);
    }
  };

  const addHighlight = (level) => {
    if (!selectionRange) return;
    
    setPendingHighlight({ level, range: selectionRange });
    setShowNoteInput(true);
  };

  const confirmHighlight = () => {
    if (!pendingHighlight) return;
    
    const newSpan = {
      start: pendingHighlight.range.start,
      end: pendingHighlight.range.end,
      level: pendingHighlight.level,
      note: highlightNote || undefined
    };
    
    if (editingDoc === 'a') {
      setDocASpans([...docASpans, newSpan].sort((a, b) => a.start - b.start));
      setDocALocked(true);
    } else {
      setDocBSpans([...docBSpans, newSpan].sort((a, b) => a.start - b.start));
      setDocBLocked(true);
    }
    
    setSelectedText('');
    setSelectionRange(null);
    setHighlightNote('');
    setShowNoteInput(false);
    setPendingHighlight(null);
  };

  const removeHighlight = (doc, index) => {
    if (doc === 'a') {
      setDocASpans(docASpans.filter((_, i) => i !== index));
      if (docASpans.length === 1) setDocALocked(false);
    } else {
      setDocBSpans(docBSpans.filter((_, i) => i !== index));
      if (docBSpans.length === 1) setDocBLocked(false);
    }
  };

  const unlockDoc = (doc) => {
    if (doc === 'a') {
      setDocASpans([]);
      setDocALocked(false);
    } else {
      setDocBSpans([]);
      setDocBLocked(false);
    }
  };

  const handleImportJSON = (doc, jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      if (doc === 'a') {
        if (data.text) setDocAText(data.text);
        if (data.spans) {
          setDocASpans(data.spans);
          setDocALocked(data.spans.length > 0);
        }
      } else {
        if (data.text) setDocBText(data.text);
        if (data.spans) {
          setDocBSpans(data.spans);
          setDocBLocked(data.spans.length > 0);
        }
      }
      alert('JSON imported successfully');
    } catch (error) {
      alert('Invalid JSON format');
    }
  };

  const handleExtractFromUrls = async () => {
    if (!docAUrl && !docBUrl) {
      alert('Please enter at least one URL');
      return;
    }
    
    setExtractingUrls(true);
    try {
      const result = await base44.functions.invoke('ExtractTextFromUrls', {
        urlA: docAUrl || null,
        urlB: docBUrl || null
      });
      
      if (result.data.ok) {
        if (result.data.textA) {
          setDocAText(result.data.textA);
          setDocALocked(false);
        }
        if (result.data.textB) {
          setDocBText(result.data.textB);
          setDocBLocked(false);
        }
        
        // Jump to step 3 (evaluation)
        setStep(3);
      } else {
        alert(result.data.error || 'Failed to extract text from URLs');
      }
    } catch (error) {
      alert('Extraction failed: ' + error.message);
    } finally {
      setExtractingUrls(false);
    }
  };

  const handleFileUpload = async (doc, file) => {
    if (!file) return;
    
    const allowedTypes = ['.pdf', '.docx', '.txt', '.md'];
    const fileName = file.name.toLowerCase();
    const isAllowed = allowedTypes.some(ext => fileName.endsWith(ext));
    
    if (!isAllowed) {
      alert('Only .pdf, .docx, .txt, and .md files are supported');
      return;
    }
    
    setUploadingFile(doc);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const result = await base44.functions.invoke('ExtractTextFromFile', formData);
      
      if (result.data.ok) {
        if (doc === 'a') {
          setDocAText(result.data.text);
          setDocALocked(false);
        } else {
          setDocBText(result.data.text);
          setDocBLocked(false);
        }
      } else {
        alert(result.data.error || 'Failed to extract text from file');
      }
    } catch (error) {
      alert('File upload failed: ' + error.message);
    } finally {
      setUploadingFile(null);
    }
  };

  const renderHighlightedText = (text, spans) => {
    if (!text || spans.length === 0) return text;
    
    const parts = [];
    let lastIndex = 0;
    
    spans.forEach((span, idx) => {
      if (span.start > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, span.start) });
      }
      parts.push({
        type: 'highlight',
        content: text.substring(span.start, span.end),
        level: span.level,
        note: span.note,
        index: idx
      });
      lastIndex = span.end;
    });
    
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }
    
    return (
      <div className="whitespace-pre-wrap font-mono text-sm">
        {parts.map((part, i) => 
          part.type === 'text' ? (
            <span key={i}>{part.content}</span>
          ) : (
            <span 
              key={i}
              className={`${
                part.level === 'confidential' ? 'bg-red-200 text-red-900' : 'bg-yellow-200 text-yellow-900'
              } px-1 rounded relative group cursor-help`}
              title={part.note || `${part.level} content`}
            >
              {part.content}
            </span>
          )
        )}
      </div>
    );
  };

  const progress = (step / 3) * 100;

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
            <span>Step {step} of 3</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Setup */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Comparison Setup</CardTitle>
                  <CardDescription>Set title and choose how you'll provide each document</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Comparison Title</Label>
                    <Input 
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., Contract A vs Contract B"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Document A Label</Label>
                      <Input 
                        value={partyALabel}
                        onChange={(e) => setPartyALabel(e.target.value)}
                        placeholder="Document A"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Document B Label</Label>
                      <Input 
                        value={partyBLabel}
                        onChange={(e) => setPartyBLabel(e.target.value)}
                        placeholder="Document B"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 p-4 border-2 border-purple-200 bg-purple-50 rounded-xl">
                    <Label className="font-semibold text-purple-900 flex items-center gap-2">
                      <LinkIcon className="w-4 h-4" />
                      Quick Start: Extract from URLs
                    </Label>
                    <p className="text-xs text-purple-700">
                      Extract text from web pages (automatically jumps to evaluation when done)
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{partyALabel} URL</Label>
                        <Input 
                          placeholder="https://..."
                          value={docAUrl}
                          onChange={(e) => setDocAUrl(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{partyBLabel} URL</Label>
                        <Input 
                          placeholder="https://..."
                          value={docBUrl}
                          onChange={(e) => setDocBUrl(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <Button 
                      onClick={handleExtractFromUrls}
                      disabled={(!docAUrl && !docBUrl) || extractingUrls}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      size="sm"
                    >
                      {extractingUrls ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Extracting...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Extract & Jump to Evaluation
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3 p-4 border border-slate-200 rounded-xl">
                      <Label className="font-semibold">{partyALabel} Input Method</Label>
                      <RadioGroup value={docASource} onValueChange={setDocASource}>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="typed" id="a-typed" />
                          <Label htmlFor="a-typed" className="font-normal cursor-pointer flex items-center gap-2">
                            <Type className="w-4 h-4" />
                            Enter text
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="uploaded" id="a-uploaded" />
                          <Label htmlFor="a-uploaded" className="font-normal cursor-pointer flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Upload file
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="space-y-3 p-4 border border-slate-200 rounded-xl">
                      <Label className="font-semibold">{partyBLabel} Input Method</Label>
                      <RadioGroup value={docBSource} onValueChange={setDocBSource}>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="typed" id="b-typed" />
                          <Label htmlFor="b-typed" className="font-normal cursor-pointer flex items-center gap-2">
                            <Type className="w-4 h-4" />
                            Enter text
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="uploaded" id="b-uploaded" />
                          <Label htmlFor="b-uploaded" className="font-normal cursor-pointer flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Upload file
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={async () => {
                      // Create draft immediately on first step completion
                      if (!comparisonId && user) {
                        const draft = await base44.entities.DocumentComparison.create({
                          title: title || 'Untitled Comparison',
                          created_by_user_id: user.id,
                          party_a_label: partyALabel,
                          party_b_label: partyBLabel,
                          status: 'draft',
                          draft_step: 2,
                          draft_updated_at: new Date().toISOString()
                        });
                        setComparisonId(draft.id);
                      } else if (comparisonId && user) {
                        await base44.entities.DocumentComparison.update(comparisonId, {
                          draft_step: 2,
                          draft_updated_at: new Date().toISOString()
                        });
                      }
                      setStep(2);
                    }} className="bg-blue-600 hover:bg-blue-700">
                      Continue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Highlight Tagging */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Document A */}
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      {partyALabel}
                    </CardTitle>
                    {docALocked && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => unlockDoc('a')}
                        className="text-orange-600"
                      >
                        <Unlock className="w-4 h-4 mr-2" />
                        Unlock (clears highlights)
                      </Button>
                    )}
                  </div>
                  <CardDescription>
                    {docALocked ? 'Text locked. Remove highlights to edit.' : 'Enter or paste text, then select to highlight'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {docASource === 'uploaded' && (
                    <div className="space-y-2">
                      <Label>Upload File (.pdf, .docx, .txt, .md)</Label>
                      <Input 
                        type="file"
                        accept=".pdf,.docx,.txt,.md"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload('a', file);
                        }}
                        disabled={uploadingFile === 'a'}
                      />
                      {uploadingFile === 'a' && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Extracting text...
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Textarea 
                      id="doc-a-textarea"
                      value={docAText}
                      onChange={(e) => {
                        if (!docALocked) {
                          setDocAText(e.target.value);
                        } else if (docASpans.length > 0) {
                          if (confirm('Editing text will clear all highlights. Continue?')) {
                            setDocAText(e.target.value);
                            setDocASpans([]);
                            setDocALocked(false);
                          }
                        }
                      }}
                      onMouseUp={() => handleTextSelection('a')}
                      placeholder="Enter or paste document text..."
                      className="min-h-[200px] font-mono text-sm"
                      disabled={docASource === 'uploaded' && uploadingFile === 'a'}
                    />
                    {docALocked && (
                      <Alert>
                        <Lock className="w-4 h-4" />
                        <AlertDescription>
                          Text locked with {docASpans.length} highlight(s). Click Unlock to edit.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {docASpans.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Highlights ({docASpans.length})</Label>
                        <div className="flex gap-1">
                          <Badge className="bg-red-100 text-red-700 text-xs">
                            {docASpans.filter(s => s.level === 'confidential').length} confidential
                          </Badge>
                          <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                            {docASpans.filter(s => s.level === 'partial').length} partial
                          </Badge>
                        </div>
                      </div>
                      <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 max-h-64 overflow-auto">
                        {renderHighlightedText(docAText, docASpans)}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Import JSON Highlights (Optional)</Label>
                    <div className="flex gap-2">
                      <Textarea 
                        value={jsonImportA}
                        onChange={(e) => setJsonImportA(e.target.value)}
                        placeholder='{"text":"...","spans":[{"start":0,"end":10,"level":"confidential"}]}'
                        className="text-xs font-mono"
                        rows={3}
                      />
                      <Button 
                        onClick={() => handleImportJSON('a', jsonImportA)}
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

              {/* Document B */}
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-600" />
                      {partyBLabel}
                    </CardTitle>
                    {docBLocked && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => unlockDoc('b')}
                        className="text-orange-600"
                      >
                        <Unlock className="w-4 h-4 mr-2" />
                        Unlock (clears highlights)
                      </Button>
                    )}
                  </div>
                  <CardDescription>
                    {docBLocked ? 'Text locked. Remove highlights to edit.' : 'Enter or paste text, then select to highlight'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {docBSource === 'uploaded' && (
                    <div className="space-y-2">
                      <Label>Upload File (.pdf, .docx, .txt, .md)</Label>
                      <Input 
                        type="file"
                        accept=".pdf,.docx,.txt,.md"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload('b', file);
                        }}
                        disabled={uploadingFile === 'b'}
                      />
                      {uploadingFile === 'b' && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Extracting text...
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Textarea 
                      id="doc-b-textarea"
                      value={docBText}
                      onChange={(e) => {
                        if (!docBLocked) {
                          setDocBText(e.target.value);
                        } else if (docBSpans.length > 0) {
                          if (confirm('Editing text will clear all highlights. Continue?')) {
                            setDocBText(e.target.value);
                            setDocBSpans([]);
                            setDocBLocked(false);
                          }
                        }
                      }}
                      onMouseUp={() => handleTextSelection('b')}
                      placeholder="Enter or paste document text..."
                      className="min-h-[200px] font-mono text-sm"
                      disabled={docBSource === 'uploaded' && uploadingFile === 'b'}
                    />
                    {docBLocked && (
                      <Alert>
                        <Lock className="w-4 h-4" />
                        <AlertDescription>
                          Text locked with {docBSpans.length} highlight(s). Click Unlock to edit.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {docBSpans.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Highlights ({docBSpans.length})</Label>
                        <div className="flex gap-1">
                          <Badge className="bg-red-100 text-red-700 text-xs">
                            {docBSpans.filter(s => s.level === 'confidential').length} confidential
                          </Badge>
                          <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                            {docBSpans.filter(s => s.level === 'partial').length} partial
                          </Badge>
                        </div>
                      </div>
                      <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 max-h-64 overflow-auto">
                        {renderHighlightedText(docBText, docBSpans)}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Import JSON Highlights (Optional)</Label>
                    <div className="flex gap-2">
                      <Textarea 
                        value={jsonImportB}
                        onChange={(e) => setJsonImportB(e.target.value)}
                        placeholder='{"text":"...","spans":[{"start":0,"end":10,"level":"confidential"}]}'
                        className="text-xs font-mono"
                        rows={3}
                      />
                      <Button 
                        onClick={() => handleImportJSON('b', jsonImportB)}
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

              {/* Highlight Controls */}
              {selectedText && selectionRange && !showNoteInput && (
                <Card className="border-2 border-blue-500 shadow-lg">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm font-semibold mb-1 block">Selected Text ({editingDoc === 'a' ? partyALabel : partyBLabel}):</Label>
                        <p className="text-sm bg-slate-100 p-2 rounded font-mono">"{selectedText.substring(0, 150)}{selectedText.length > 150 ? '...' : ''}"</p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => addHighlight('confidential')}
                          className="bg-red-600 hover:bg-red-700 flex-1"
                          size="sm"
                        >
                          <Highlighter className="w-4 h-4 mr-2" />
                          Confidential
                        </Button>
                        <Button 
                          onClick={() => addHighlight('partial')}
                          className="bg-yellow-600 hover:bg-yellow-700 flex-1"
                          size="sm"
                        >
                          <Highlighter className="w-4 h-4 mr-2" />
                          Partial
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => {
                            setSelectedText('');
                            setSelectionRange(null);
                          }}
                          size="sm"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {showNoteInput && (
                <Card className="border-2 border-purple-500 shadow-lg">
                  <CardContent className="p-4 space-y-3">
                    <Label>Optional Note (visible only in editing view)</Label>
                    <Input 
                      value={highlightNote}
                      onChange={(e) => setHighlightNote(e.target.value)}
                      placeholder="e.g., Client name, pricing details..."
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="outline"
                        onClick={() => {
                          setShowNoteInput(false);
                          setPendingHighlight(null);
                          setHighlightNote('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={confirmHighlight} className="bg-purple-600 hover:bg-purple-700">
                        Add Highlight
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={async () => {
                  if (comparisonId && user) {
                    await base44.entities.DocumentComparison.update(comparisonId, { 
                      draft_step: 1,
                      draft_updated_at: new Date().toISOString()
                    });
                  }
                  setStep(1);
                }}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => saveDraftMutation.mutate()}
                    disabled={saveDraftMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <Button 
                    onClick={async () => {
                      if (comparisonId && user) {
                        await base44.entities.DocumentComparison.update(comparisonId, { 
                          draft_step: 3,
                          draft_updated_at: new Date().toISOString()
                        });
                      }
                      setStep(3);
                    }}
                    disabled={!docAText || !docBText}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Review
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Review & Submit</CardTitle>
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
                        <p className="text-3xl font-bold text-red-700">{docASpans.filter(s => s.level === 'confidential').length + docBSpans.filter(s => s.level === 'confidential').length}</p>
                        <p className="text-sm text-red-600 mt-1">Confidential Spans</p>
                      </div>
                    </div>
                    <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-xl">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-yellow-700">{docASpans.filter(s => s.level === 'partial').length + docBSpans.filter(s => s.level === 'partial').length}</p>
                        <p className="text-sm text-yellow-600 mt-1">Partial Spans</p>
                      </div>
                    </div>
                  </div>

                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Confidentiality Guarantee:</strong> Confidential and partial content will never be quoted or revealed in the shared AI report. 
                      The AI will read them for analysis but will only provide high-level, redacted insights.
                    </AlertDescription>
                  </Alert>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={async () => {
                      if (comparisonId && user) {
                        await base44.entities.DocumentComparison.update(comparisonId, { 
                          draft_step: 2,
                          draft_updated_at: new Date().toISOString()
                        });
                      }
                      setStep(2);
                    }}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        onClick={() => saveDraftMutation.mutate()}
                        disabled={saveDraftMutation.isPending}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                      <Button 
                        onClick={async () => {
                          try {
                            const id = comparisonId || await saveDraftMutation.mutateAsync();
                            const result = await base44.functions.invoke('EvaluateDocumentComparison', {
                              comparison_id: id
                            });
                            
                            if (!result.data.ok) {
                              alert('Evaluation failed: ' + (result.data.error || 'Unknown error'));
                              return;
                            }
                            
                            navigate(createPageUrl(`DocumentComparisonDetail?id=${id}`));
                          } catch (error) {
                            alert('Evaluation failed: ' + error.message);
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