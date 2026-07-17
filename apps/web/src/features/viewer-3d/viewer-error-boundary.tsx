"use client";

import { Component } from "react";
import type { ReactNode } from "react";

interface ViewerErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (error: Error) => void;
  readonly resetKey: string;
}

interface ViewerErrorBoundaryState {
  readonly failed: boolean;
  readonly resetKey: string;
}

export class ViewerErrorBoundary extends Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  override state: ViewerErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(
    props: ViewerErrorBoundaryProps,
    state: ViewerErrorBoundaryState,
  ): ViewerErrorBoundaryState | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(): Partial<ViewerErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
