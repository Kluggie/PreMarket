import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function getErrorMessage(error) {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error.message || 'Unknown editor error');
}

export default class DocumentComparisonEditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    console.error('Document comparison editor crashed.', error, info);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = getErrorMessage(this.state.error);
    const showDetails = Boolean(import.meta?.env?.DEV && message);

    return (
      <Card className="border border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle>We hit an error loading the editor.</CardTitle>
          <CardDescription>
            You can retry loading this step, or return to Step 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showDetails ? (
            <p className="text-sm text-red-800 font-mono break-words">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button onClick={this.handleRetry}>
              Retry
            </Button>
            <Button variant="outline" onClick={this.props.onBackToStep1}>
              Back to Step 1
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
}
