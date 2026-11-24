import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra lỗi không mong muốn trong quá trình xử lý.',
    };
  }

  render() {
    if (this.state.hasError) {
      let displayMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          displayMsg = `Lỗi quyền truy cập hoặc dữ liệu (${parsed.operationType || 'read'}): ${parsed.error}`;
        }
      } catch {
        // Keep plain message
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-50 text-red-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  Hệ thống gặp sự cố xử lý dữ liệu
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed break-words">
                  {displayMsg}
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                Tải lại ứng dụng
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
