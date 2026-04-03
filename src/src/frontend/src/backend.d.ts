import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface AssistantResponse {
    content: string;
    timestamp: Time;
}
export interface TransformationOutput {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export type Time = bigint;
export interface ConversationEntry {
    id: bigint;
    message: Message;
    response: AssistantResponse;
    timestamp: Time;
}
export interface TransformationInput {
    context: Uint8Array;
    response: http_request_result;
}
export interface Message {
    content: string;
    sender: Principal;
    timestamp: Time;
}
export interface http_header {
    value: string;
    name: string;
}
export interface http_request_result {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface backendInterface {
    deleteMessage(id: bigint): Promise<void>;
    getAllMessages(): Promise<Array<ConversationEntry>>;
    getMessage(id: bigint): Promise<ConversationEntry>;
    isConnected(): Promise<boolean>;
    sendMessage(messageText: string): Promise<bigint>;
    transform(input: TransformationInput): Promise<TransformationOutput>;
}
