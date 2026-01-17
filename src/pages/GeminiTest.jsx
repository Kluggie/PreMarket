import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function GeminiTest() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const runTest = async () => {
        setLoading(true);
        setResult(null);
        
        try {
            const { data } = await base44.functions.invoke('testVertexGemini');
            setResult(data);
        } catch (error) {
            setResult({
                ok: false,
                error: error.message || 'Network error'
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900">Vertex Gemini Integration Test</h1>
                    <p className="text-slate-600 mt-2">Test the custom Vertex Gemini 3 Evaluator integration</p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Integration Test</CardTitle>
                        <CardDescription>
                            Sends a test request to Gemini 3 Flash Preview
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="bg-slate-100 rounded-lg p-4 text-sm">
                            <div className="font-mono space-y-1 text-slate-700">
                                <div><span className="text-slate-500">Project:</span> premarket-484606</div>
                                <div><span className="text-slate-500">Location:</span> us-central1</div>
                                <div><span className="text-slate-500">Model:</span> gemini-3-flash-preview</div>
                                <div><span className="text-slate-500">Prompt:</span> "Reply with exactly: OK"</div>
                            </div>
                        </div>

                        <Button 
                            onClick={runTest} 
                            disabled={loading}
                            className="w-full"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Testing Integration...
                                </>
                            ) : (
                                'Run Gemini Test'
                            )}
                        </Button>

                        {result && (
                            <Alert className={result.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                                <div className="flex items-start gap-3">
                                    {result.ok ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                                    ) : (
                                        <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                                    )}
                                    <div className="flex-1 space-y-2">
                                        <div className="font-semibold">
                                            {result.ok ? 'Success' : 'Error'}
                                        </div>
                                        {result.ok ? (
                                            <div className="space-y-2">
                                                <div>
                                                    <div className="text-sm text-slate-600 mb-1">Response Text:</div>
                                                    <div className="bg-white rounded p-3 font-mono text-sm border">
                                                        {result.text}
                                                    </div>
                                                </div>
                                                {result.raw && (
                                                    <details className="text-xs">
                                                        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                                                            View raw response
                                                        </summary>
                                                        <pre className="mt-2 bg-white rounded p-3 overflow-auto border max-h-64">
                                                            {JSON.stringify(result.raw, null, 2)}
                                                        </pre>
                                                    </details>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <AlertDescription className="text-red-800">
                                                    {result.error}
                                                </AlertDescription>
                                                {result.raw && (
                                                    <details className="text-xs">
                                                        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                                                            View error details
                                                        </summary>
                                                        <pre className="mt-2 bg-white rounded p-3 overflow-auto border max-h-64">
                                                            {JSON.stringify(result.raw, null, 2)}
                                                        </pre>
                                                    </details>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}