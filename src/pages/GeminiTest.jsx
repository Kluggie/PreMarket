import React, { useState, useEffect } from 'react';
import { authClient } from '@/api/authClient';
import { legacyClient } from '@/api/legacyClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

export default function GeminiTest() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [autoRan, setAutoRan] = useState(false);

    useEffect(() => {
        const loadUser = async () => {
            try {
                const userData = await authClient.me();
                setUser(userData);
            } catch (e) {
                setUser(null);
            }
        };
        loadUser();
    }, []);

    useEffect(() => {
        if (user?.role === 'admin' && !autoRan && !loading) {
            setAutoRan(true);
            runTest();
        }
    }, [user, autoRan, loading]);

    const runTest = async () => {
        setLoading(true);
        setResult(null);
        
        try {
            const { data } = await legacyClient.functions.invoke('GenerateContent', {
                text: 'Reply with exactly: OK'
            });
            setResult(data);
        } catch (error) {
            const status = error.response?.status;
            const errorMessage = status === 401 
                ? 'Authentication failed - please refresh the page and try again'
                : status === 403
                ? 'Access denied - admin privileges required'
                : error.message || 'Network error';
            
            setResult({
                ok: false,
                outputText: null,
                raw: {
                    error: errorMessage,
                    status: status,
                    details: error.response?.data || error.message
                }
            });
        } finally {
            setLoading(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
        );
    }

    if (user.role !== 'admin') {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Card className="max-w-md">
                    <CardHeader>
                        <CardTitle className="text-red-600">Access Denied</CardTitle>
                        <CardDescription>Admin access required</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

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

                        <div className="flex gap-2">
                            <Button 
                                onClick={runTest} 
                                disabled={loading}
                                className="flex-1"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Testing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Run Test
                                    </>
                                )}
                            </Button>
                            {result && (
                                <Button 
                                    onClick={() => setResult(null)} 
                                    variant="outline"
                                >
                                    Clear
                                </Button>
                            )}
                        </div>

                        {result && (
                            <div className="space-y-4">
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

                                            {result.ok && result.outputText && (
                                                <div>
                                                    <div className="text-sm text-slate-600 mb-1">Output Text:</div>
                                                    <div className="bg-white rounded p-3 font-mono text-sm border">
                                                        {result.outputText}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {!result.ok && result.raw?.error && (
                                                <AlertDescription className="text-red-800">
                                                    {typeof result.raw.error === 'string' 
                                                        ? result.raw.error 
                                                        : JSON.stringify(result.raw.error)}
                                                </AlertDescription>
                                            )}
                                        </div>
                                    </div>
                                </Alert>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm">Full JSON Response</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <pre className="text-xs bg-slate-900 text-slate-100 rounded p-4 overflow-auto max-h-96">
                                            {JSON.stringify(result, null, 2)}
                                        </pre>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}