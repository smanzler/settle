import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, View } from "react-native";

/** The whole auth screen: the centred card and the keyboard-aware shell round it. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView className="flex-1">
      <View className="flex-1 flex flex-col justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">{children}</CardContent>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}
