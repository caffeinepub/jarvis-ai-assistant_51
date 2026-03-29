import Map "mo:core/Map";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Order "mo:core/Order";
import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Outcall "http-outcalls/outcall";

actor {
  type AllowedPrincipal = { #specific : Principal; #anonymous };

  type Message = {
    sender : Principal;
    content : Text;
    timestamp : Time.Time;
  };

  type AssistantResponse = {
    content : Text;
    timestamp : Time.Time;
  };

  type ConversationEntry = {
    id : Nat;
    message : Message;
    response : AssistantResponse;
    timestamp : Time.Time;
  };

  module ConversationEntry {
    public func compare(a : ConversationEntry, b : ConversationEntry) : Order.Order {
      Nat.compare(a.id, b.id);
    };
  };

  public type ConversationHistory = [ConversationEntry];

  let conversationEntries = Map.empty<Nat, ConversationEntry>();
  var nextConversationEntryId = 0;
  let createdAt = Time.now();

  func getNextConversationEntryId() : Nat {
    let id = nextConversationEntryId;
    nextConversationEntryId += 1;
    id;
  };

  let duckDuckGoApiBaseUrl = "https://api.duckduckgo.com/?q=";
  let duckDuckGoApiParams = "&format=json&no_html=1&skip_disambig=1";

  func makeDuckDuckGoApiUrl(searchQuery : Text) : Text {
    duckDuckGoApiBaseUrl # searchQuery.replace(#char ' ', "+") # duckDuckGoApiParams;
  };

  func getConversationEntryOrTrap(id : Nat) : ConversationEntry {
    switch (conversationEntries.get(id)) {
      case (null) { Runtime.trap("No conversation entry with id " # id.toText()) };
      case (?conversationEntry) { conversationEntry };
    };
  };

  public query func transform(input : Outcall.TransformationInput) : async Outcall.TransformationOutput {
    Outcall.transform(input);
  };

  public shared ({ caller }) func sendMessage(messageText : Text) : async Nat {
    let timestamp = Time.now();
    let message : Message = {
      sender = caller;
      content = messageText;
      timestamp;
    };
    let id = getNextConversationEntryId();

    let apiResponse = await Outcall.httpGetRequest(makeDuckDuckGoApiUrl(messageText), [], transform);

    let conversationEntry : ConversationEntry = {
      id;
      message;
      response = {
        content = apiResponse;
        timestamp;
      };
      timestamp;
    };
    conversationEntries.add(conversationEntry.id, conversationEntry);
    conversationEntry.id;
  };

  public query ({ caller }) func getMessage(id : Nat) : async ConversationEntry {
    getConversationEntryOrTrap(id);
  };

  public query ({ caller }) func getAllMessages() : async [ConversationEntry] {
    conversationEntries.values().toArray().sort();
  };

  public shared ({ caller }) func deleteMessage(id : Nat) : async () {
    ignore getConversationEntryOrTrap(id);
    conversationEntries.remove(id);
  };

  public query ({ caller }) func isConnected() : async Bool {
    true;
  };
};
