import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Database, ArrowRight } from 'lucide-react';

export default function AdminMigration() {
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState(null);

  const runMigration = async () => {
    setMigrating(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('migrateTemplateQuestions', {});
      setResult(response.data);
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Template Migration</h1>
          <p className="text-slate-600 mt-2">
            Migrate template questions from embedded JSON to normalized TemplateQuestion records.
          </p>
        </div>

        <Card className="border-0 shadow-sm mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              Template Question Migration
            </CardTitle>
            <CardDescription>
              This migration copies questions from Template.data.questions to separate TemplateQuestion records.
              The embedded data is NOT deleted (kept as backup).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-900">Migration Details</p>
                    <ul className="text-sm text-blue-700 mt-2 space-y-1">
                      <li>• Creates TemplateVersion records (one per template)</li>
                      <li>• Creates TemplateQuestion records for each question</li>
                      <li>• Maps party (a/b/both) to applies_to_role (proposer/recipient/both)</li>
                      <li>• Sets default values for role-aware fields</li>
                      <li>• Skips templates with no questions or already migrated</li>
                      <li>• Does NOT delete or modify existing Template.data.questions</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Button
                onClick={runMigration}
                disabled={migrating}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {migrating ? (
                  'Migrating...'
                ) : (
                  <>
                    Run Migration
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {result && (
          <Card className={`border-0 shadow-sm ${result.success ? 'border-green-200' : 'border-red-200'}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.success ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Migration Complete
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    Migration Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.success ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.templates_processed}
                      </div>
                      <div className="text-sm text-slate-600">Templates Processed</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.versions_created}
                      </div>
                      <div className="text-sm text-slate-600">Versions Created</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="text-2xl font-bold text-slate-900">
                        {result.migration_log.questions_created}
                      </div>
                      <div className="text-sm text-slate-600">Questions Created</div>
                    </div>
                  </div>

                  {result.migration_log.details && result.migration_log.details.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="font-semibold text-slate-900">Details:</h3>
                      {result.migration_log.details.map((detail, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                          <span className="text-sm text-slate-700">{detail.template_name}</span>
                          <Badge variant={detail.status === 'success' ? 'default' : 'outline'}>
                            {detail.status === 'success' 
                              ? `${detail.questions_migrated} questions` 
                              : detail.reason
                            }
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.migration_log.errors && result.migration_log.errors.length > 0 && (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
                      <h3 className="font-semibold text-red-900 mb-2">Errors:</h3>
                      {result.migration_log.errors.map((error, idx) => (
                        <div key={idx} className="text-sm text-red-700">
                          {error.template_name}: {error.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-red-700">{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}