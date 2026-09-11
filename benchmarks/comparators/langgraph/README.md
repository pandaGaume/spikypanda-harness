# Comparateur LangGraph isolé

Ce dossier n'est ni un workspace du produit ni une dépendance de la bibliothèque.
Il contient un essai local avec le vrai runtime LangGraph, sans LLM ni service
commercial. Le verrou de dépendances est indépendant de celui du dépôt.

L'adaptateur exécute exactement la politique à règles du banc dans un nœud
StateGraph. Le test d'équivalence compare toutes les décisions, observations
et métriques physiques des dix scénarios. Il ne représente pas une architecture
LangGraph optimisée pour le produit et ne permet pas de classer les moteurs.

Installation depuis la racine :

```sh
npm --prefix benchmarks/comparators/langgraph ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm run test:benchmark:langgraph
npm run benchmark:production -- --controller langgraph --split development --out dist/benchmarks
```

Les imports désactivent le traçage distant pour ce processus. Aucune clé API
n'est requise. Les dépendances ne sont jamais chargées par la démo ou les tests
ordinaires du harnais.

Voir le [protocole de comparaison](../../../docs/BENCHMARK_PRODUCTION_V1.md),
notamment ses règles d'équité et ses critères de poursuite ou d'abandon.
