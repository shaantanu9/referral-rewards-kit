package dev.referralkit.referral_kit

import android.content.Context
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Google Block Store access for the install id (ADR 8). Cloud backup is always off: the value stays on this
 * phone (and survives uninstall/reinstall when the user has Google backup on) and can move to a new phone only in
 * device-to-device setup. Any failure (no Play services, old Play services) answers null/false, and the Dart side
 * falls back to flutter_secure_storage.
 */
class ReferralKitPlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    private lateinit var channel: MethodChannel
    private lateinit var context: Context

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "referral_kit/block_store")
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val key = call.argument<String>("key")
        if (key.isNullOrEmpty()) {
            result.error("bad_args", "key is required", null)
            return
        }
        try {
            when (call.method) {
                "read" -> read(key, result)
                "write" -> write(key, call.argument<String>("value"), result)
                else -> result.notImplemented()
            }
        } catch (e: Exception) {
            result.success(if (call.method == "read") null else false)
        }
    }

    private fun read(key: String, result: MethodChannel.Result) {
        val request = RetrieveBytesRequest.Builder().setKeys(listOf(key)).build()
        Blockstore.getClient(context).retrieveBytes(request)
            .addOnSuccessListener { response ->
                val bytes = response.blockstoreDataMap[key]?.bytes
                result.success(bytes?.toString(Charsets.UTF_8))
            }
            .addOnFailureListener { result.success(null) }
    }

    private fun write(key: String, value: String?, result: MethodChannel.Result) {
        if (value.isNullOrEmpty()) {
            result.success(false)
            return
        }
        val data = StoreBytesData.Builder()
            .setKey(key)
            .setBytes(value.toByteArray(Charsets.UTF_8))
            .setShouldBackupToCloud(false)
            .build()
        Blockstore.getClient(context).storeBytes(data)
            .addOnSuccessListener { result.success(true) }
            .addOnFailureListener { result.success(false) }
    }
}
