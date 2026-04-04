"use client";

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { useMemo } from "react";
import { graphqlEndpoint } from "@/lib/graphql";

export function ApolloAppProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () =>
      new ApolloClient({
        cache: new InMemoryCache(),
        link: new HttpLink({ uri: graphqlEndpoint(), fetchOptions: { cache: "no-store" } }),
      }),
    [],
  );
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
