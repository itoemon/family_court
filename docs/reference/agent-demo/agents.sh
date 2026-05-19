#!/bin/bash
# ============================================
# agents.sh
# 各エージェントを単体で呼び出すユーティリティ
# 使い方: ./agents.sh [architect|engineer|auditor]
# ============================================

AGENT=$1

case $AGENT in

  # 設計者だけ呼び出す
  architect)
    echo "📐 [設計者Claude] 起動..."
    claude \
      --system "あなたはシニアアーキテクトです。要件を読んで設計書を作ることだけに集中してください。コードは書かないでください。"
    ;;

  # 実装者だけ呼び出す
  engineer)
    echo "💻 [実装者Claude] 起動..."
    claude \
      --system "あなたはReactエンジニアです。設計書を読んでコードを実装することだけに集中してください。セキュリティレビューはしないでください。"
    ;;

  # 審査者だけ呼び出す
  auditor)
    echo "🔍 [審査者Claude] 起動..."
    claude \
      --system "あなたはセキュリティ・品質レビュー担当です。コードをレビューしてレポートを書くことだけに集中してください。コードの修正はしないでください。"
    ;;

  *)
    echo "使い方: ./agents.sh [architect|engineer|auditor]"
    echo ""
    echo "  architect  - 設計者Claude（要件 → 設計書）"
    echo "  engineer   - 実装者Claude（設計書 → コード）"
    echo "  auditor    - 審査者Claude（コード → レビュー）"
    ;;
esac
